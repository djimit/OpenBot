/**
 * Everything a managed VM needs to exist before one can be created: Apple's
 * `container` CLI and its services, and the OpenBOT guest image.
 *
 * Both are expensive, one-time, and shared by every VM, so each is memoised
 * behind a promise that is dropped again on failure — a first-use download or
 * image build must not be retried concurrently, but must be retryable.
 */

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app } from 'electron'
import { dirname, join } from 'node:path'
import { dataRoot } from '../store/paths'
import { commandRunner } from './commandRunner'
import type { ProgressReporter } from './types'

const APPLE_CONTAINER_VERSION = '1.2.2'
const APPLE_CONTAINER_PACKAGE = `container-${APPLE_CONTAINER_VERSION}-installer-signed.pkg`
const APPLE_CONTAINER_PACKAGE_URL =
  `https://github.com/apple/container/releases/download/${APPLE_CONTAINER_VERSION}/${APPLE_CONTAINER_PACKAGE}`
const APPLE_CONTAINER_PACKAGE_SHA256 = 'f4c7e73f7203725a3512676dfd9ec6c6a98a37093b6fd4a1b0fdcfcb227e2118'
// Keep the guest image revision separate from the app version. Development
// builds commonly retain the same package version, so tagging only with that
// version silently reused an older Chromium-only image after the desktop was
// added.
const IMAGE_REVISION = 'desktop-v1'
export const IMAGE = `openbot-box:${app.getVersion() || 'dev'}-${IMAGE_REVISION}`
const RUNTIME_DOWNLOAD_LIMIT = 256 * 1024 * 1024

let runtimePromise: Promise<string> | undefined
let imagePromise: Promise<void> | undefined

/** Drops the memoised runtime and image so a replaced command runner is honoured. */
export function resetAppleContainerCaches(): void {
  runtimePromise = undefined
  imagePromise = undefined
}

function imageContextDir(): string {
  const packaged = join(process.resourcesPath, 'vm-image')
  const development = join(app.getAppPath(), 'vm-image')
  const selected = app.isPackaged ? packaged : development
  if (!existsSync(join(selected, 'Containerfile'))) {
    throw new Error(`The managed-VM Containerfile is missing from ${selected}.`)
  }
  return selected
}

function runtimeBase(): string {
  return join(dataRoot(), 'vm-runtime', `apple-container-${APPLE_CONTAINER_VERSION}`)
}

function runtimeInstallRoot(): string {
  return join(runtimeBase(), 'install')
}

export function runtimeBinary(): string {
  return join(runtimeInstallRoot(), 'bin', 'container')
}

export async function runtime(signal?: AbortSignal, report: ProgressReporter = () => undefined): Promise<string> {
  if (!runtimePromise) runtimePromise = resolveRuntime(signal, report).catch((error) => {
    runtimePromise = undefined
    throw error
  })
  return await runtimePromise
}

async function resolveRuntime(signal?: AbortSignal, report: ProgressReporter = () => undefined): Promise<string> {
  report({ stage: 'preparing-runtime', detail: 'Checking Apple\'s native VM runtime…' })
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error(
      'Private managed VMs require Apple silicon and macOS 26 or newer. You can still connect an external VM endpoint.'
    )
  }

  const explicit = process.env['OPENBOT_VM_RUNTIME']?.trim()
  if (explicit) {
    await commandRunner(explicit, ['--version'], { timeoutMs: 10_000, signal })
    await ensureRuntimeStarted(explicit, dirname(dirname(explicit)), signal, report, explicit === runtimeBinary())
    return explicit
  }

  const installed = '/usr/local/bin/container'
  if (existsSync(installed)) {
    await commandRunner(installed, ['--version'], { timeoutMs: 10_000, signal })
    await ensureRuntimeStarted(installed, '/usr/local', signal, report, false)
    return installed
  }

  if (!existsSync(runtimeBinary())) await installPrivateRuntime(signal, report)
  await commandRunner(runtimeBinary(), ['--version'], { timeoutMs: 10_000, signal })
  await ensureRuntimeStarted(runtimeBinary(), runtimeInstallRoot(), signal, report, true)
  return runtimeBinary()
}

async function ensureRuntimeStarted(
  binary: string,
  installRoot: string,
  signal?: AbortSignal,
  report: ProgressReporter = () => undefined,
  ownsStorage = false
): Promise<void> {
  let running = false
  try {
    await commandRunner(binary, ['system', 'status'], { timeoutMs: 10_000, signal })
    running = true
    // Apple container services are per-user singletons. A second OpenBOT data
    // profile can invoke them through its own verified CLI, but must not try to
    // install a kernel into that profile's inactive app-root: the running
    // service owns its existing kernel store and `kernel set` otherwise fails
    // with a misleading "item already exists" error.
    ownsStorage = false
  } catch {
    if (signal?.aborted) throw new Error('VM operation cancelled.')
  }
  const root = runtimeBase()
  const appRoot = join(root, 'data')
  const logRoot = join(root, 'logs')
  await mkdir(appRoot, { recursive: true })
  await mkdir(logRoot, { recursive: true })
  if (!running) {
    report({ stage: 'starting-runtime', detail: 'Starting Apple\'s VM services…' })
    // Keep service startup and the large kernel download as distinct,
    // cancellable stages. The CLI otherwise hides both behind one long call.
    await commandRunner(binary, [
      'system', 'start',
      '--app-root', appRoot,
      '--install-root', installRoot,
      '--log-root', logRoot,
      '--disable-kernel-install',
      '--timeout', '120'
    ], { timeoutMs: 3 * 60_000, signal })
    ownsStorage = true
  }

  if (ownsStorage) {
    const defaultKernel = join(appRoot, 'kernels', `default.kernel-${process.arch}`)
    if (!existsSync(defaultKernel)) {
      report({
        stage: 'installing-kernel',
        detail: 'Downloading Apple\'s recommended Linux VM kernel…'
      })
      await commandRunner(binary, ['system', 'kernel', 'set', '--recommended'], {
        timeoutMs: 20 * 60_000,
        signal
      })
      if (!existsSync(defaultKernel)) {
        throw new Error('Apple\'s VM runtime finished without installing its default kernel.')
      }
    }
  }
}

async function installPrivateRuntime(
  signal?: AbortSignal,
  report: ProgressReporter = () => undefined
): Promise<void> {
  const root = runtimeBase()
  const downloads = join(root, 'downloads')
  const packagePath = join(downloads, APPLE_CONTAINER_PACKAGE)
  const staging = join(root, `.install-${randomUUID()}`)
  await mkdir(downloads, { recursive: true })
  await rm(staging, { recursive: true, force: true })

  try {
    if (!existsSync(packagePath) || await sha256File(packagePath) !== APPLE_CONTAINER_PACKAGE_SHA256) {
      report({ stage: 'downloading-runtime', detail: 'Downloading Apple\'s signed VM runtime…' })
      const partial = `${packagePath}.${randomUUID()}.part`
      await rm(partial, { force: true })
      const timeoutSignal = AbortSignal.timeout(10 * 60_000)
      const response = await fetch(APPLE_CONTAINER_PACKAGE_URL, {
        redirect: 'follow',
        signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
      })
      if (!response.ok || !response.body) {
        throw new Error(`Apple VM runtime download failed with HTTP ${response.status}.`)
      }
      const advertisedSize = Number(response.headers.get('content-length'))
      if (Number.isFinite(advertisedSize) && advertisedSize > RUNTIME_DOWNLOAD_LIMIT) {
        throw new Error('Apple VM runtime download exceeded the 256 MiB safety limit.')
      }
      try {
        let received = 0
        const limiter = new Transform({
          transform(chunk: Buffer, _encoding, done): void {
            received += chunk.length
            done(
              received > RUNTIME_DOWNLOAD_LIMIT
                ? new Error('Apple VM runtime download exceeded the 256 MiB safety limit.')
                : undefined,
              chunk
            )
          }
        })
        await pipeline(
          Readable.fromWeb(response.body as never),
          limiter,
          createWriteStream(partial, { mode: 0o600 })
        )
        const digest = await sha256File(partial)
        if (digest !== APPLE_CONTAINER_PACKAGE_SHA256) {
          throw new Error(`Apple VM runtime checksum mismatch (received ${digest}).`)
        }
        await rename(partial, packagePath)
      } finally {
        await rm(partial, { force: true }).catch(() => undefined)
      }
    }

    report({ stage: 'preparing-runtime', detail: 'Verifying and unpacking Apple\'s signed VM runtime…' })
    await commandRunner('pkgutil', ['--check-signature', packagePath], { timeoutMs: 30_000, signal })
    await commandRunner('pkgutil', ['--expand-full', packagePath, staging], { timeoutMs: 120_000, signal })
    if (!existsSync(join(staging, 'Payload', 'bin', 'container'))) {
      throw new Error('The verified Apple VM runtime package had an unexpected layout.')
    }
    await rm(runtimeInstallRoot(), { recursive: true, force: true })
    await rename(join(staging, 'Payload'), runtimeInstallRoot())
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function sha256File(path: string): Promise<string> {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk as Buffer)
  return digest.digest('hex')
}

export async function ensureImage(
  binary: string,
  signal?: AbortSignal,
  report: ProgressReporter = () => undefined
): Promise<void> {
  if (!imagePromise) imagePromise = (async () => {
    try {
      await commandRunner(binary, ['image', 'inspect', IMAGE], { timeoutMs: 15_000, signal })
      return
    } catch {
      if (signal?.aborted) throw new Error('VM operation cancelled.')
      // First use builds the auditable OCI image in vm-image/Containerfile.
    }
    report({
      stage: 'building-image',
      detail: 'Building the private VM image and installing Chromium…'
    })
    await commandRunner(binary, [
      'build', '--pull', '--progress', 'plain',
      '--file', join(imageContextDir(), 'Containerfile'),
      '--tag', IMAGE,
      imageContextDir()
    ], { timeoutMs: 30 * 60_000, signal })
  })().catch((error) => {
    imagePromise = undefined
    throw error
  })
  await imagePromise
}

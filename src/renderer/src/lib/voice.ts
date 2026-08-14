/**
 * Voice input — deliberately switched off, and honest about it.
 *
 * Chromium's Web Speech API is not on-device: `webkitSpeechRecognition` streams
 * microphone audio to Google's servers, and it does so from the browser process
 * where the renderer's CSP cannot reach it. This app promises no telemetry, so
 * that alone rules the API out. Independently, src/main/app/permissions.ts
 * grants nothing but `clipboard-sanitized-write`, so audio capture is denied
 * without a prompt and every attempt ended the same way: a toast reading the raw
 * jargon "Voice input failed: not-allowed."
 *
 * The old guard could not save it. `webkitSpeechRecognition` exists in every
 * Chromium build, so `if (!Recognition) return null` never fired and the caller's
 * clear fallback — use macOS Dictation, which runs on the machine — was
 * unreachable. The policy gate below fires first instead, before anything can
 * open a microphone or reach a network.
 */

interface SpeechAlternative { transcript: string }
interface SpeechResult { 0: SpeechAlternative; isFinal: boolean }
interface SpeechEvent { results: ArrayLike<SpeechResult>; resultIndex: number }
interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechEvent) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}
type SpeechConstructor = new () => SpeechRecognitionLike

export interface VoiceSession { stop(): void }

/**
 * Whether speech recognition may run at all.
 *
 * A constant, not a feature test: the reasons it may not are policy (audio
 * leaves the machine; the microphone is denied by design), and a capability
 * check would answer "yes" to both. It stays a function so the machinery below
 * remains live code — wiring up a local, on-device engine is then this one line
 * plus a constructor, not a resurrection.
 */
function speechRecognitionAllowed(): boolean {
  return false
}

export function startVoiceInput(callbacks: {
  result(text: string, final: boolean): void
  error(message: string): void
  end(): void
}): VoiceSession | null {
  if (!speechRecognitionAllowed()) return null
  const speechWindow = window as unknown as { SpeechRecognition?: SpeechConstructor; webkitSpeechRecognition?: SpeechConstructor }
  const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
  if (!Recognition) return null
  /*
   * Construction and `start()` throw synchronously — an insecure context, a
   * second start on a live session — and this runs inside a click handler, which
   * React error boundaries do not catch. An uncaught throw there kills the
   * toggle with no toast and no way back, so both are caught and answered with
   * null: the caller then shows its fallback, which is the useful outcome.
   */
  let recognition: SpeechRecognitionLike
  try {
    recognition = new Recognition()
  } catch {
    return null
  }
  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = navigator.language || 'en-GB'
  recognition.onresult = (event) => {
    let finalText = ''
    let interim = ''
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index]
      const transcript = result?.[0]?.transcript ?? ''
      if (result?.isFinal) finalText += transcript
      else interim += transcript
    }
    if (finalText) callbacks.result(finalText, true)
    if (interim) callbacks.result(interim, false)
  }
  // A Web Speech error code is jargon to the person who pressed the button, and
  // the only actionable answer is the same one the caller gives when this module
  // declines outright: dictate on the machine instead.
  recognition.onerror = () => callbacks.error('Voice input stopped. You can use macOS Dictation in the message field instead.')
  recognition.onend = callbacks.end
  try {
    recognition.start()
  } catch {
    return null
  }
  return {
    stop: () => {
      /*
       * Handlers go before the stop. `stop()` is followed by a last `onend` (and
       * sometimes a final `onresult`), and each of those closures holds the
       * composer's setState functions — a composer that has since unmounted, or
       * moved on to another session, would be written to by a session it no
       * longer owns. The caller resets its own state when it calls stop.
       */
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      recognition.stop()
    }
  }
}

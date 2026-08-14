/**
 * Push/pull bridge between callback-style events (child stdio, JSON-RPC
 * notifications) and `for await`. Values queue when the producer outruns
 * the consumer; closing with an error surfaces it at the iteration site.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = []
  private readonly resolvers: Array<(r: IteratorResult<T>) => void> = []
  private readonly rejecters: Array<(e: unknown) => void> = []
  private closed = false
  private failure: unknown

  get pending(): number {
    return this.values.length
  }

  push(value: T): void {
    if (this.closed) return
    const resolve = this.resolvers.shift()
    this.rejecters.shift()
    if (resolve) resolve({ value, done: false })
    else this.values.push(value)
  }

  close(err?: unknown): void {
    if (this.closed) return
    this.closed = true
    this.failure = err
    if (err !== undefined) {
      const rejecters = this.rejecters.splice(0)
      this.resolvers.length = 0
      for (const reject of rejecters) reject(err)
      return
    }
    const resolvers = this.resolvers.splice(0)
    this.rejecters.length = 0
    for (const resolve of resolvers) resolve({ value: undefined, done: true })
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    for (;;) {
      if (this.values.length) {
        yield this.values.shift() as T
        continue
      }
      if (this.closed) {
        if (this.failure !== undefined) throw this.failure
        return
      }
      const next = await new Promise<IteratorResult<T>>((resolve, reject) => {
        this.resolvers.push(resolve)
        this.rejecters.push(reject)
      })
      if (next.done) {
        if (this.failure !== undefined) throw this.failure
        return
      }
      yield next.value
    }
  }
}

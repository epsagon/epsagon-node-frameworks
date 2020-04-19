// epsagon.d.ts
declare module 'epsagon' {
  import 'aws-lambda'

  export function init(options: {
    token: string
    appName: string
    metadataOnly?: boolean
    useSSL?: boolean
    traceCollectorURL?: string
    isEpsagonDisabled?: boolean
    urlPatternsToIgnore?: string[]
    sendOnlyErrors?: boolean
    sendTimeout?: number
  }): void
  export function label(key: string, value: string): void
  export function setError(error: Error): void
  export function ignoreEndpoints(endpoints: string[]): void
}

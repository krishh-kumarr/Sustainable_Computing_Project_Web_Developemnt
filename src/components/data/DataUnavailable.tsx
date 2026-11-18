import { AlertCircle, ExternalLink, KeyRound, RefreshCw, SearchX } from 'lucide-react'
import { ApiError, describeError } from '../../services/api/client'
import { getSource, type SourceId } from '../../services/config/dataSources'

interface Props {
  /** What the reader was expecting to see. */
  title: string
  error?: ApiError | null
  sourceId?: SourceId
  /** Extra context specific to this panel. */
  explanation?: string
  onRetry?: () => void
  className?: string
}

/**
 * The honest empty state. Never a placeholder number, never a blank area —
 * it names the source, says what went wrong, and offers a retry when retrying
 * could plausibly help.
 */
export default function DataUnavailable({ title, error, sourceId, explanation, onRetry, className = '' }: Props) {
  const source = sourceId ? getSource(sourceId) : error?.sourceId ? getSource(error.sourceId) : null
  const missingKey = error?.kind === 'auth' ? (error.missingKeyEnvVar ?? source?.keyEnvVar) : null

  const Icon = missingKey ? KeyRound : error?.kind === 'empty' || error?.kind === 'unsupported-location' ? SearchX : AlertCircle

  return (
    <div className={`bg-white border border-dashed border-graphite/20 rounded-xl p-6 ${className}`}>
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-graphite/4 flex items-center justify-center shrink-0 mt-0.5">
          <Icon size={15} className="text-graphite/40" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-1">
            Data unavailable
          </div>
          <h4 className="text-sm font-semibold text-graphite mb-2">{title}</h4>

          {error && <p className="text-sm text-graphite/55 leading-relaxed mb-2">{describeError(error)}</p>}
          {explanation && <p className="text-sm text-graphite/55 leading-relaxed mb-2">{explanation}</p>}

          {missingKey && (
            <div className="bg-amber/8 border border-amber/25 rounded-lg p-3 mb-3">
              <div className="text-[11px] font-semibold text-graphite mb-1">Set up the credential</div>
              <ol className="text-[12px] text-graphite/60 leading-relaxed list-decimal list-inside space-y-0.5">
                <li>
                  Get a free key
                  {source?.keySignupUrl && (
                    <>
                      {' '}
                      from{' '}
                      <a
                        href={source.keySignupUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sage underline inline-flex items-center gap-0.5"
                      >
                        {source.provider} <ExternalLink size={9} />
                      </a>
                    </>
                  )}
                  .
                </li>
                <li>
                  Add <code className="px-1 py-0.5 bg-graphite/6 rounded text-[11px] font-mono">{missingKey}</code>{' '}
                  to your <code className="px-1 py-0.5 bg-graphite/6 rounded text-[11px] font-mono">.env</code>.
                </li>
                <li>Restart the API proxy so it picks up the new value.</li>
              </ol>
              <p className="text-[11px] text-graphite/45 mt-2">
                The key stays server-side. It is never sent to the browser.
              </p>
            </div>
          )}

          {error?.detail != null && typeof error.detail === 'string' && error.detail.length < 300 && (
            <p className="text-[11px] text-graphite/35 font-mono leading-relaxed mb-2 break-words">
              {error.detail}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 mt-1">
            {onRetry && error?.retryable !== false && (
              <button
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-graphite/15 text-graphite/70 hover:text-graphite hover:border-graphite/30 transition-colors"
              >
                <RefreshCw size={11} /> Retry
              </button>
            )}
            {source?.docsUrl && (
              <a
                href={source.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-graphite/40 hover:text-sage inline-flex items-center gap-1 transition-colors"
              >
                {source.name} documentation <ExternalLink size={9} />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

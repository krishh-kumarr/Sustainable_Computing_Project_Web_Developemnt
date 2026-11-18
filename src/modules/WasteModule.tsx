import { useCallback, useEffect, useRef, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ExternalLink, FileWarning, Image as ImageIcon, Loader2, Upload, X } from 'lucide-react'
import { AXIS_TICK, CHART_GRID_STROKE, TOOLTIP_STYLE, unitFormatter } from '../components/data/chartFormat'
import DataSourceBadge from '../components/data/DataSourceBadge'
import DataSourceStatus from '../components/data/DataSourceStatus'
import LastUpdated from '../components/data/LastUpdated'
import Panel from '../components/data/Panel'
import { SceneLegend, LegendRow, ModuleLayout, type ModuleProps } from './shared'
import {
  CATEGORY_LABEL,
  CATEGORY_STREAM,
  ClassifierUnavailableError,
  MATERIAL_CATEGORIES,
  WASTE_DATASETS,
  classifierState,
  classifyImage,
  validateImageFile,
  type ClassificationResponse,
  type MaterialCategory,
} from '../services/domain/wasteClassification'
import { round } from '../services/data/normalizers/units'

type ClassifyState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; response: ClassificationResponse }
  | { status: 'failed'; message: string }

export default function WasteModule({ sim }: ModuleProps) {
  const classifier = classifierState()

  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [classify, setClassify] = useState<ClassifyState>({ status: 'idle' })
  const [dragging, setDragging] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Object URLs must be revoked or the blob leaks for the page's lifetime.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => () => abortRef.current?.abort(), [])

  const accept = useCallback((incoming: File | null) => {
    setClassify({ status: 'idle' })
    if (!incoming) {
      setFile(null)
      setValidationError(null)
      return
    }
    const error = validateImageFile(incoming)
    setValidationError(error)
    setFile(error ? null : incoming)
  }, [])

  const runClassification = useCallback(async () => {
    if (!file) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setClassify({ status: 'running' })
    try {
      const response = await classifyImage(file, { signal: controller.signal })
      if (!controller.signal.aborted) setClassify({ status: 'done', response })
    } catch (error) {
      if (controller.signal.aborted) return
      setClassify({
        status: 'failed',
        message:
          error instanceof ClassifierUnavailableError
            ? error.message
            : `The model service call failed: ${String((error as Error)?.message ?? error)}`,
      })
    }
  }, [file])

  const scoreRows =
    classify.status === 'done'
      ? classify.response.scores.map((score) => ({
          category: CATEGORY_LABEL[score.category],
          raw: score.category,
          percent: round(score.probability * 100, 1),
        }))
      : []

  return (
    <ModuleLayout
      main={
        <>
          {/* ── Model status, stated before anything else ─────────── */}
          <div className="bg-white border border-graphite/12 rounded-xl p-5">
            <div className="flex items-start gap-3">
              <span className="w-8 h-8 rounded-lg bg-graphite/4 flex items-center justify-center shrink-0 mt-0.5">
                <FileWarning size={15} className="text-graphite/45" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <span className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium">
                    Model status
                  </span>
                  <DataSourceBadge
                    kind="unavailable"
                    overrideLabel={
                      classifier.status === 'ready' ? 'MODEL CONFIGURED' : 'MODEL INTEGRATION PENDING'
                    }
                  />
                </div>
                <h3 className="text-[15px] font-semibold text-graphite mb-2">
                  {classifier.status === 'ready'
                    ? 'A classification service is configured'
                    : 'No classifier is installed in this application'}
                </h3>
                {classifier.status === 'ready' ? (
                  <p className="text-[12px] text-graphite/60 leading-relaxed">
                    Requests go to{' '}
                    <code className="px-1 py-0.5 bg-graphite/6 rounded font-mono text-[11px] break-all">
                      {classifier.endpoint}
                    </code>
                    . Any accuracy figure shown below is reported by that service, with its own stated basis —
                    this application never supplies one.
                  </p>
                ) : (
                  <p className="text-[12px] text-graphite/60 leading-relaxed">
                    This phase builds the upload interface, the result interface and the service layer against a
                    documented response contract. There is no bundled model, no inference code, and therefore no
                    prediction and no accuracy figure. Uploading an image below will show you exactly where the
                    integration stops.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* ── Upload ───────────────────────────────────────────── */}
          <Panel
            eyebrow="Input"
            title="Waste image upload"
            description="Validated in the browser. Nothing is uploaded anywhere unless a model endpoint is configured."
            bodyClassName="pt-0"
          >
            <div className="space-y-4">
              <div
                onDragOver={(event) => {
                  event.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault()
                  setDragging(false)
                  accept(event.dataTransfer.files?.[0] ?? null)
                }}
                className={`rounded-xl border-2 border-dashed transition-colors ${
                  dragging ? 'border-sage/60 bg-sage/5' : 'border-graphite/15 bg-graphite/[0.02]'
                }`}
              >
                {previewUrl ? (
                  <div className="p-4">
                    <div className="relative rounded-lg overflow-hidden bg-graphite/5">
                      <img
                        src={previewUrl}
                        alt={file?.name ?? 'Uploaded waste image'}
                        className="w-full max-h-[320px] object-contain"
                      />
                      <button
                        onClick={() => accept(null)}
                        className="absolute top-2 right-2 w-7 h-7 rounded-full bg-graphite/70 text-ivory flex items-center justify-center hover:bg-graphite transition-colors"
                        aria-label="Remove image"
                      >
                        <X size={13} />
                      </button>
                    </div>
                    {file && (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[11px] text-graphite/50">
                        <span className="font-medium text-graphite/70 truncate max-w-[200px]">{file.name}</span>
                        <span className="tabular-nums">{round(file.size / 1024, 0)} KB</span>
                        <span>{file.type}</span>
                        <span className="tabular-nums">
                          {new Date(file.lastModified).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center py-12 px-6 cursor-pointer text-center">
                    <span className="w-11 h-11 rounded-xl bg-white border border-graphite/10 flex items-center justify-center mb-3">
                      <ImageIcon size={17} className="text-graphite/35" />
                    </span>
                    <span className="text-[13px] font-medium text-graphite mb-1">
                      Drop an image here, or click to choose one
                    </span>
                    <span className="text-[11px] text-graphite/45">JPEG, PNG or WebP, up to 8 MB</span>
                    <input
                      ref={inputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(event) => accept(event.target.files?.[0] ?? null)}
                    />
                  </label>
                )}
              </div>

              {validationError && (
                <div className="flex items-start gap-2 bg-amber/8 border border-amber/25 rounded-lg px-3 py-2.5">
                  <FileWarning size={12} className="text-amber shrink-0 mt-0.5" />
                  <p className="text-[11px] text-graphite/60 leading-relaxed">{validationError}</p>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={runClassification}
                  disabled={!file || classify.status === 'running'}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold rounded-lg text-white transition-opacity disabled:opacity-35 disabled:cursor-not-allowed"
                  style={{ backgroundColor: sim.color }}
                >
                  {classify.status === 'running' ? (
                    <>
                      <Loader2 size={12} className="animate-spin" /> Classifying
                    </>
                  ) : (
                    <>
                      <Upload size={12} /> Classify image
                    </>
                  )}
                </button>
                {file && (
                  <button
                    onClick={() => accept(null)}
                    className="text-[11px] text-graphite/50 hover:text-graphite underline"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </Panel>

          {/* ── Result ───────────────────────────────────────────── */}
          <Panel
            eyebrow="Output"
            title="Classification result"
            description="A material category appears here only when a real model returns one. There is no placeholder prediction."
            actions={
              classify.status === 'done' ? <DataSourceBadge kind="model" size="sm" /> : undefined
            }
            bodyClassName="pt-0"
          >
            {classify.status === 'idle' && (
              <p className="text-[12px] text-graphite/50 leading-relaxed">
                No classification has been run. Upload an image and press Classify.
              </p>
            )}

            {classify.status === 'running' && (
              <div className="flex items-center gap-2 text-[12px] text-graphite/50">
                <Loader2 size={12} className="animate-spin" /> Waiting for the model service…
              </div>
            )}

            {classify.status === 'failed' && (
              <div className="space-y-3">
                <div className="flex items-start gap-2.5 bg-graphite/[0.03] border border-dashed border-graphite/20 rounded-lg px-4 py-3.5">
                  <FileWarning size={13} className="text-graphite/40 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-1">
                      No result
                    </div>
                    <p className="text-[12px] text-graphite/60 leading-relaxed">{classify.message}</p>
                  </div>
                </div>
                <div className="bg-graphite/[0.03] border border-graphite/10 rounded-lg p-4">
                  <div className="text-[10px] uppercase tracking-widest text-graphite/40 font-medium mb-2">
                    To connect a model
                  </div>
                  <ol className="text-[11px] text-graphite/55 leading-relaxed list-decimal list-inside space-y-1">
                    <li>
                      Train or obtain a classifier over the seven categories listed in the panel to the right.
                    </li>
                    <li>
                      Serve it behind an HTTP endpoint accepting <code className="font-mono">multipart/form-data</code>{' '}
                      with an <code className="font-mono">image</code> field.
                    </li>
                    <li>
                      Return the documented <code className="font-mono">ClassificationResponse</code> shape,
                      including your model's name, version, training dataset, and — if you state one — its
                      accuracy together with the basis it was measured on.
                    </li>
                    <li>
                      Set <code className="font-mono">VITE_WASTE_MODEL_ENDPOINT</code> to that URL and restart the
                      dev server. If your model needs a credential, put it behind the backend proxy instead.
                    </li>
                  </ol>
                </div>
              </div>
            )}

            {classify.status === 'done' && (
              <div className="space-y-5">
                <div
                  className="rounded-xl border p-5"
                  style={{ borderColor: `${sim.color}40`, backgroundColor: `${sim.color}0C` }}
                >
                  <div className="text-[10px] uppercase tracking-widest text-graphite/40 font-medium mb-1.5">
                    Predicted category
                  </div>
                  <div className="flex items-baseline gap-3 mb-2">
                    <span className="text-[32px] leading-none font-semibold" style={{ color: sim.color }}>
                      {CATEGORY_LABEL[classify.response.predictedCategory]}
                    </span>
                    <span className="text-sm font-semibold text-graphite/60 tabular-nums">
                      {round(classify.response.scores[0].probability * 100, 1)}%
                    </span>
                  </div>
                  <p className="text-[12px] text-graphite/60 leading-relaxed">
                    {CATEGORY_STREAM[classify.response.predictedCategory]}
                  </p>
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-2">
                    Full score distribution
                  </div>
                  <ResponsiveContainer width="100%" height={Math.max(scoreRows.length * 28, 140)}>
                    <BarChart data={scoreRows} layout="vertical" margin={{ top: 0, right: 12, left: -6, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                      <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} domain={[0, 100]} />
                      <YAxis
                        type="category"
                        dataKey="category"
                        tick={AXIS_TICK}
                        axisLine={false}
                        tickLine={false}
                        width={78}
                      />
                      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={unitFormatter('%', { percent: 'Probability' })} />
                      <Bar dataKey="percent" radius={[0, 3, 3, 0]}>
                        {scoreRows.map((row, index) => (
                          <Cell key={row.raw} fill={index === 0 ? sim.color : `${sim.color}55`} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <p className="text-[11px] text-graphite/45 leading-relaxed mt-2">
                    The spread matters as much as the top class. A near-tie means the model is uncertain, whatever
                    the headline category says.
                  </p>
                </div>

                <div className="bg-graphite/[0.03] border border-graphite/10 rounded-lg p-4 space-y-1.5">
                  <div className="text-[10px] uppercase tracking-widest text-graphite/40 font-medium mb-1">
                    Model that produced this
                  </div>
                  {[
                    ['Name', classify.response.model.name],
                    ['Version', classify.response.model.version],
                    ['Trained on', classify.response.model.trainedOn],
                    ['Inference time', `${classify.response.inferenceMs} ms`],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-baseline justify-between gap-3">
                      <span className="text-[11px] text-graphite/50">{label}</span>
                      <span className="text-[11px] font-medium text-graphite/75 text-right">{value}</span>
                    </div>
                  ))}
                  {classify.response.model.reportedAccuracy !== undefined ? (
                    <div className="pt-2 mt-1 border-t border-graphite/8">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[11px] text-graphite/50">Accuracy, as reported by the service</span>
                        <span className="text-[11px] font-semibold text-graphite tabular-nums">
                          {round(classify.response.model.reportedAccuracy * 100, 1)}%
                        </span>
                      </div>
                      <p className="text-[10px] text-graphite/45 leading-relaxed mt-1">
                        Basis: {classify.response.model.accuracyBasis}. This figure comes from the model service,
                        not from this application.
                      </p>
                    </div>
                  ) : (
                    <p className="text-[10px] text-graphite/45 leading-relaxed pt-2 mt-1 border-t border-graphite/8">
                      The service reported no accuracy figure with a stated basis, so none is shown.
                    </p>
                  )}
                </div>

                <LastUpdated
                  observedAt={classify.response.predictedAt}
                  fetchedAt={classify.response.predictedAt}
                  label="Predicted"
                />
              </div>
            )}
          </Panel>

          {/* ── Datasets ─────────────────────────────────────────── */}
          <Panel
            eyebrow="Reference datasets"
            title="Public waste-image datasets a classifier would train on"
            description="Counts and composition exactly as the dataset authors publish them. Nothing in this codebase has been trained on or evaluated against either dataset."
            actions={<DataSourceBadge kind="historical" size="sm" overrideLabel="PUBLISHED DATASET FACTS" />}
            bodyClassName="pt-0"
          >
            <div className="space-y-5">
              {WASTE_DATASETS.map((dataset) => (
                <div key={dataset.name} className="border border-graphite/10 rounded-xl p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-2.5">
                    <div className="min-w-0">
                      <a
                        href={dataset.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[13px] font-semibold text-graphite hover:text-sage inline-flex items-center gap-1"
                      >
                        {dataset.fullName} <ExternalLink size={9} className="text-graphite/35" />
                      </a>
                      <div className="text-[11px] text-graphite/45 mt-0.5">Licence: {dataset.licence}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-3">
                    {[
                      ['Images', dataset.imageCount.toLocaleString()],
                      ['Annotations', dataset.annotationCount?.toLocaleString() ?? '—'],
                      ['Classes', String(dataset.classCount)],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <div className="text-[10px] uppercase tracking-wider text-graphite/35 font-medium mb-0.5">
                          {label}
                        </div>
                        <div className="text-[15px] font-semibold text-graphite tabular-nums">{value}</div>
                      </div>
                    ))}
                  </div>

                  {dataset.composition && (
                    <div className="mb-3">
                      <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-2">
                        Published per-class composition
                      </div>
                      <ResponsiveContainer width="100%" height={150}>
                        <BarChart
                          data={dataset.composition}
                          margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                          <XAxis
                            dataKey="label"
                            tick={{ ...AXIS_TICK, fontSize: 10 }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} />
                          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={unitFormatter('images', { count: 'Images' })} />
                          <Bar dataKey="count" fill={sim.color} radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  <p className="text-[11px] text-graphite/55 leading-relaxed">{dataset.notes}</p>
                </div>
              ))}
            </div>
          </Panel>
        </>
      }
      aside={
        <>
          <DataSourceStatus
            entries={[
              {
                sourceId: 'none',
                state: classifier.status === 'ready' ? 'live' : 'not-integrated',
                detail:
                  classifier.status === 'ready'
                    ? `Model service configured at ${classifier.endpoint}.`
                    : 'No trained classifier and no model endpoint. VITE_WASTE_MODEL_ENDPOINT is unset.',
              },
            ]}
          />

          <Panel
            eyebrow="Taxonomy"
            title="Material categories"
            description="The seven classes the response contract defines. A category is displayed only when a model returns it."
            bodyClassName="pt-0"
          >
            <ul className="space-y-2.5">
              {MATERIAL_CATEGORIES.map((category: MaterialCategory) => (
                <li key={category}>
                  <div className="text-[12px] font-medium text-graphite">{CATEGORY_LABEL[category]}</div>
                  <div className="text-[11px] text-graphite/45 leading-snug">{CATEGORY_STREAM[category]}</div>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel
            eyebrow="Contract"
            title="Expected response shape"
            description="Validated before any result reaches the interface. An off-contract response produces an error, not a rendered guess."
            bodyClassName="pt-0"
          >
            <pre className="text-[10px] leading-relaxed text-graphite/65 font-mono bg-graphite/[0.03] border border-graphite/10 rounded-lg p-3 overflow-x-auto">
{`{
  "predictedCategory": "plastic",
  "scores": [
    { "category": "plastic", "probability": 0.87 },
    { "category": "glass",   "probability": 0.07 }
  ],
  "model": {
    "name": "resnet50-trashnet",
    "version": "1.2.0",
    "trainedOn": "TrashNet (2527 images)",
    "reportedAccuracy": 0.91,
    "accuracyBasis": "506-image held-out
                      test split, top-1"
  },
  "inferenceMs": 142,
  "predictedAt": "2026-11-05T12:00:00Z"
}`}
            </pre>
            <p className="text-[11px] text-graphite/45 leading-relaxed mt-2.5">
              <code className="font-mono text-[10px]">reportedAccuracy</code> is carried through only when{' '}
              <code className="font-mono text-[10px]">accuracyBasis</code> is also present. A bare accuracy number
              with no stated basis is not evidence, so it is dropped.
            </p>
          </Panel>

          <SceneLegend title="What this module shows">
            <LegendRow
              swatch="#10B981"
              label="Uploaded image"
              meaning="your own file, previewed locally in the browser"
              derived
            />
            <LegendRow
              swatch="#6EE7B7"
              label="Score distribution"
              meaning="probabilities returned by a configured model service"
              derived
            />
            <LegendRow
              swatch="#065F46"
              label="Dataset charts"
              meaning="counts published by the TrashNet and TACO authors"
              derived
            />
            <LegendRow
              swatch="#8A8780"
              label="Recycling rate, sort accuracy"
              meaning="not shown anywhere — no source measures them for your location"
              derived={false}
            />
          </SceneLegend>
        </>
      }
    />
  )
}

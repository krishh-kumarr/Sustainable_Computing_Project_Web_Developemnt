/**
 * Waste-image classification service layer.
 *
 * State of play, stated plainly because the UI repeats it to the user: this
 * application contains NO trained classifier. There is no bundled model, no
 * inference code and therefore no accuracy figure. What exists here is the
 * contract a real model would have to satisfy, and the client that would call
 * it, so that integrating one later is a configuration change rather than a
 * rewrite.
 *
 * To connect a model, set VITE_WASTE_MODEL_ENDPOINT to an HTTP endpoint that
 * accepts `multipart/form-data` with an `image` field and responds with the
 * `ClassificationResponse` shape below. That variable is a public URL, not a
 * secret, which is why it is safe as a VITE_ variable. If your model needs a
 * credential, put the endpoint behind the backend proxy instead.
 */

export const MATERIAL_CATEGORIES = [
  'plastic',
  'paper',
  'glass',
  'metal',
  'cardboard',
  'organic',
  'other',
] as const

export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number]

export const CATEGORY_LABEL: Record<MaterialCategory, string> = {
  plastic: 'Plastic',
  paper: 'Paper',
  glass: 'Glass',
  metal: 'Metal',
  cardboard: 'Cardboard',
  organic: 'Organic',
  other: 'Other',
}

/** Where each stream usually goes. Guidance, not a classification result. */
export const CATEGORY_STREAM: Record<MaterialCategory, string> = {
  plastic: 'Dry recyclable — resin code determines whether it is actually accepted locally.',
  paper: 'Dry recyclable — contamination with food or grease usually disqualifies it.',
  glass: 'Dry recyclable — colour-sorted in most facilities; often collected separately.',
  metal: 'Dry recyclable — ferrous and non-ferrous both have established markets.',
  cardboard: 'Dry recyclable — flatten; wax-coated board is generally rejected.',
  organic: 'Wet waste — compostable or suitable for anaerobic digestion.',
  other: 'Residual — typically landfill or energy recovery.',
}

// ── Response contract ─────────────────────────────────────────────────────

export interface CategoryScore {
  category: MaterialCategory
  /** Model-reported probability for this class, 0–1. */
  probability: number
}

export interface ClassificationResponse {
  /** The highest-scoring class. */
  predictedCategory: MaterialCategory
  /** Full distribution, so the UI can show the model's uncertainty. */
  scores: CategoryScore[]
  /** Identity of the model that produced this — never fabricated locally. */
  model: {
    name: string
    version: string
    /** Dataset it was trained on, so the result can be read in context. */
    trainedOn: string
    /**
     * Held-out accuracy as reported BY THE MODEL SERVICE. This field is only
     * ever populated from the service's own response. The app never fills it
     * in, and renders nothing when it is absent.
     */
    reportedAccuracy?: number
    /** What the reportedAccuracy was measured on. Required if accuracy is set. */
    accuracyBasis?: string
  }
  /** Server-side inference time, milliseconds. */
  inferenceMs: number
  /** The model service's own timestamp. */
  predictedAt: string
}

export type ClassifierState =
  /** No endpoint configured: there is no model to call. */
  | { status: 'not-configured' }
  | { status: 'ready'; endpoint: string }

export function classifierState(): ClassifierState {
  const endpoint = import.meta.env.VITE_WASTE_MODEL_ENDPOINT
  if (typeof endpoint === 'string' && endpoint.trim() !== '') {
    return { status: 'ready', endpoint: endpoint.trim() }
  }
  return { status: 'not-configured' }
}

export class ClassifierUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClassifierUnavailableError'
  }
}

function isMaterialCategory(value: unknown): value is MaterialCategory {
  return typeof value === 'string' && (MATERIAL_CATEGORIES as readonly string[]).includes(value)
}

/** Validate a model service's response. Rejects anything off-contract. */
export function parseClassificationResponse(raw: unknown): ClassificationResponse {
  if (!raw || typeof raw !== 'object') {
    throw new ClassifierUnavailableError('The model service returned a non-object response.')
  }
  const body = raw as Record<string, unknown>

  if (!isMaterialCategory(body.predictedCategory)) {
    throw new ClassifierUnavailableError(
      `The model service returned an unrecognised category: ${String(body.predictedCategory)}.`,
    )
  }

  const scores: CategoryScore[] = Array.isArray(body.scores)
    ? body.scores
        .map((item) => {
          const s = item as Record<string, unknown>
          const probability = Number(s.probability)
          if (!isMaterialCategory(s.category) || !Number.isFinite(probability)) return null
          return { category: s.category, probability }
        })
        .filter((s): s is CategoryScore => s !== null)
    : []

  if (scores.length === 0) {
    throw new ClassifierUnavailableError('The model service returned no class scores.')
  }

  const model = (body.model ?? {}) as Record<string, unknown>
  const reportedAccuracy = Number(model.reportedAccuracy)

  return {
    predictedCategory: body.predictedCategory,
    scores: scores.sort((a, b) => b.probability - a.probability),
    model: {
      name: String(model.name ?? 'Unnamed model'),
      version: String(model.version ?? 'unversioned'),
      trainedOn: String(model.trainedOn ?? 'unspecified dataset'),
      // Only carried through when the service states both the number and what
      // it was measured on. A bare number without a basis is not evidence.
      ...(Number.isFinite(reportedAccuracy) && model.accuracyBasis
        ? { reportedAccuracy, accuracyBasis: String(model.accuracyBasis) }
        : {}),
    },
    inferenceMs: Number.isFinite(Number(body.inferenceMs)) ? Number(body.inferenceMs) : 0,
    predictedAt: String(body.predictedAt ?? new Date().toISOString()),
  }
}

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
export const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export function validateImageFile(file: File): string | null {
  if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
    return `Unsupported file type "${file.type || 'unknown'}". Use JPEG, PNG or WebP.`
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `Image is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`
  }
  return null
}

/**
 * Sends an image to the configured model service.
 *
 * Throws ClassifierUnavailableError when no endpoint is configured — the UI
 * renders a "model integration pending" state in that case and shows nothing
 * resembling a prediction.
 */
export async function classifyImage(
  file: File,
  options: { signal?: AbortSignal } = {},
): Promise<ClassificationResponse> {
  const state = classifierState()
  if (state.status === 'not-configured') {
    throw new ClassifierUnavailableError(
      'No classification model is configured. Set VITE_WASTE_MODEL_ENDPOINT to a model service that implements the documented response contract.',
    )
  }

  const validationError = validateImageFile(file)
  if (validationError) throw new ClassifierUnavailableError(validationError)

  const form = new FormData()
  form.append('image', file, file.name)

  let response: Response
  try {
    response = await fetch(state.endpoint, { method: 'POST', body: form, signal: options.signal })
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error
    throw new ClassifierUnavailableError(
      `Could not reach the model service at ${state.endpoint}. ${String((error as Error)?.message ?? '')}`,
    )
  }

  if (!response.ok) {
    throw new ClassifierUnavailableError(`The model service returned HTTP ${response.status}.`)
  }

  return parseClassificationResponse(await response.json())
}

// ── Public datasets this contract is designed against ────────────────────

export interface WasteDataset {
  name: string
  fullName: string
  url: string
  licence: string
  /** Figures as documented by the dataset's own authors. */
  imageCount: number
  annotationCount: number | null
  classCount: number
  /** Per-class composition, where the authors publish it. */
  composition: { label: string; count: number }[] | null
  notes: string
}

/**
 * Both entries below are the counts the dataset authors publish. They describe
 * the datasets, not this application's performance — nothing here has been
 * trained on or evaluated against them in this codebase.
 */
export const WASTE_DATASETS: WasteDataset[] = [
  {
    name: 'TrashNet',
    fullName: 'TrashNet — Yang & Thung, Stanford CS229 (2016)',
    url: 'https://github.com/garythung/trashnet',
    licence: 'MIT (code); images released with the dataset',
    imageCount: 2527,
    annotationCount: null,
    classCount: 6,
    composition: [
      { label: 'Paper', count: 594 },
      { label: 'Glass', count: 501 },
      { label: 'Plastic', count: 482 },
      { label: 'Metal', count: 410 },
      { label: 'Cardboard', count: 403 },
      { label: 'Trash', count: 137 },
    ],
    notes:
      'Single object per image, photographed against a plain white background under controlled lighting. A classifier trained only on TrashNet tends to degrade sharply on cluttered real-world photographs.',
  },
  {
    name: 'TACO',
    fullName: 'TACO — Trash Annotations in Context (Proença & Simões, 2020)',
    url: 'http://tacodataset.org/',
    licence: 'CC BY 4.0',
    imageCount: 1500,
    annotationCount: 4784,
    classCount: 60,
    composition: null,
    notes:
      'Litter photographed in situ — on pavements, beaches and in vegetation — with segmentation masks across 60 categories in 28 supercategories. Much harder and much more representative than TrashNet, but class-imbalanced, with many categories holding only a handful of annotations.',
  },
]

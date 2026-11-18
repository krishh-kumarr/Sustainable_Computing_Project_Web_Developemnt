/// <reference types="vite/client" />

/**
 * Frontend environment variables.
 *
 * Only non-secret values belong here: every VITE_ variable is inlined into the
 * client bundle and is therefore public. Credentials live in the backend
 * proxy's environment instead — see .env.example.
 */
interface ImportMetaEnv {
  /**
   * HTTP endpoint of a waste-image classification service implementing the
   * contract in src/services/domain/wasteClassification.ts. A public URL, not
   * a secret. Unset means no classifier is available, and the Smart Waste
   * module says so rather than showing a placeholder prediction.
   */
  readonly VITE_WASTE_MODEL_ENDPOINT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

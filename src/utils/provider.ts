import type { CodexModels } from '../types/models'

import { CODEX_BASE_URL } from './const'

export interface CreateCodexOptions {

}

export interface CreateCodexResult {
  responses: (model: CodexModels | (string & {})) => {
    apiKey: string
    baseURL: string
    model: string
  }
}

export const createCodex = async (_options: CreateCodexOptions): Promise<CreateCodexResult> => {
  return {
    responses: model => ({
      apiKey: '',
      baseURL: CODEX_BASE_URL,
      model,
    }),
  }
}

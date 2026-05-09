import type { ResponsesOptions } from '@xsai-ext/responses'

import type { CodexModels } from '../types/models'

import { CODEX_BASE_URL } from './const'

export interface CreateCodexOptions {

}

export interface CreateCodexResult {
  responses: (model: CodexModels | (string & {})) => Pick<ResponsesOptions, 'apiKey' | 'baseURL' | 'headers' | 'model'>
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

# xsAI Codex

OpenAI Codex provider for xsAI.

## Usage

```ts
import { responses } from '@xsai-ext/responses'
import { authorizeCodexHeadless, createCodex } from 'xsai-codex'

const auth = await authorizeCodexHeadless({
  onUserCode: ({ instructions }) => {
    console.log(instructions)
  },
})

const codex = await createCodex({ auth })

const result = responses({
  ...(await codex('gpt-5.5')),
  input: 'Write a small TypeScript function.',
  instructions: 'You\'re a helpful assistant.',
  // maxOutputTokens: 0 // Codex doesn't support `maxOutputTokens`.
  store: false, // `store` must be `false`.
})
```

### Example

```bash
git clone https://github.com/moeru-ai/xsai-codex
cd xsai-codex
pnpm i
pnpm dev
```

## License

[MIT](LICENSE.md)

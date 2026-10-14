# xsAI Codex

OpenAI Codex provider for xsAI.

```bash
pnpm add xsai-codex @xsai/shared @xsai/text @xsai/text-responses
```

## Usage

Enable [device code authentication](https://learn.chatgpt.com/docs/auth#login-on-headless-devices) in your ChatGPT settings.
Open the URL shown in the terminal. Enter the code.

```ts
import { generateText } from '@xsai/text'
import { authorizeCodexHeadless, createCodex } from 'xsai-codex'

const auth = await authorizeCodexHeadless({
  onUserCode: ({ instructions }) => {
    console.log(instructions)
  },
})

const codex = await createCodex({ auth })

const result = await generateText(codex('gpt-6.1-sol'), {
  input: 'Write a small TypeScript function.',
  instructions: 'You\'re a helpful assistant.',
})

console.log(result.text)
```

The provider refreshes tokens before they expire. Use `onAuthUpdate` to save the new tokens.

### Example

```bash
git clone https://github.com/moeru-ai/xsai-codex
cd xsai-codex
pnpm i
pnpm dev
```

The example saves tokens in `.env.local`.

## License

[MIT](LICENSE.md)

import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'

export default tseslint.config([
  globalIgnores([
    'dist',
    // Codice sostituito dalla nuova pagina "Modifica frasi" (PhrasesPage +
    // PhraseEditor) e dal client API in src/api/: lasciato sul disco solo
    // perché non è stato possibile eliminarlo automaticamente in questa
    // sessione, ma non è più referenziato da nessun punto dell'app.
    'src/components/ConfigEditorList.tsx',
    'src/pages/BlasfemiaPage.tsx',
    'src/pages/FrasiBenvenutoPage.tsx',
    'src/hooks/use-toast.tsx',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
])

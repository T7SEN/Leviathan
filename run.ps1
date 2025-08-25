# Tooling/config files
@'
node_modules
.env
dist
.prisma
prisma/dev.db
prisma/dev.db-journal
.cache
.cache/**
.cache-avatars
.cache-avatars/**
'@ | Set-Content .gitignore -Encoding UTF8

@'
{
  "useTabs": true,
  "singleQuote": true,
  "semi": false,
  "printWidth": 80,
  "trailingComma": "all"
}
'@ | Set-Content .prettierrc -Encoding UTF8

@'
/* eslint-env node */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: ['./tsconfig.json'],
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'eslint-config-prettier',
  ],
  rules: {
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/consistent-type-imports': 'error',
    'import/order': [
      'error',
      {
        'newlines-between': 'always',
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
      },
    ],
  },
}
'@ | Set-Content .eslintrc.cjs -Encoding UTF8

@'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "outDir": "dist",
    "rootDir": ".",
    "noEmitOnError": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"],
    "useDefineForClassFields": true
  },
  "include": ["src", "scripts", "prisma"]
}
'@ | Set-Content tsconfig.json -Encoding UTF8

# Folders
mkdir src, prisma, scripts, docs | Out-Null
mkdir src\commands, src\commands\levels, src\commands\xp, src\config, src\events, src\lib, src\types | Out-Null

# Stubs to paste code into (open in VS Code and paste from earlier messages)
ni scripts\deploy-commands.ts, `
   src\index.ts, `
   src\event-registry.ts, `
   src\command-registry.ts, `
   src\config\constants.ts, src\config\env.ts, src\config\intents.ts, `
   src\events\ready.ts, src\events\interaction-create.ts, src\events\message-create.ts, src\events\voice-state-update.ts, `
   src\lib\logger.ts, src\lib\prisma.ts, src\lib\xp.ts, src\lib\cooldowns.ts, src\lib\guards.ts, src\lib\error-handler.ts, src\lib\avatar-cache.ts, src\lib\rank-card.ts, `
   src\types\command.ts, `
   src\commands\levels\rank.ts, src\commands\levels\leaderboard.ts, src\commands\levels\config.ts, src\commands\levels\reset.ts, `
   src\commands\xp\mod.ts, `
   prisma\schema.sqlite.prisma, prisma\schema.mongodb.prisma -ItemType File -Force | Out-Null

# Env (dev with SQLite)
@'
DISCORD_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-app-id
DEV_GUILD_ID=your-dev-guild-id
DATABASE_URL="file:./dev.db"
LOG_LEVEL=info
'@ | Set-Content .env -Encoding UTF8

# Prisma (dev): copy sqlite schema into place, then generate & push
npm run prisma:use:sqlite
npm run prisma:generate
npm run prisma:push

# First commit
git add -A
git commit -m "init(leviathan): bootstrap project, tooling, prisma, env"

# Register slash commands to your dev guild (set DEV_GUILD_ID)
npm run deploy:cmd:dev

# Run in dev
npm run dev
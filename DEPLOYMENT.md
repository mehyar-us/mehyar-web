# MehyarSoft Website - GitHub Pages Deployment

This repository contains the MehyarSoft website, a modern React application built with Vite, TypeScript, and Tailwind CSS.

## 🚀 Live Site

The website is automatically deployed to GitHub Pages at: `https://YOUR_USERNAME.github.io/mehyar-web/`

## 🏗️ Deployment Methods

### Method 1: Automatic Deployment (Recommended)

The site is automatically deployed to GitHub Pages whenever you push to the `main` or `master` branch using GitHub Actions.

**Setup:**
1. Go to your repository settings
2. Navigate to **Pages** section
3. Under **Source**, select "GitHub Actions"
4. The workflow will automatically run on every push

### Method 2: Manual Deployment Script

Use the TypeScript deployment script for manual deployments:

```bash
# Deploy with build
npm run deploy:pages:local

# Or if you already built the app
npm run deploy:pages
```

### Method 3: One-time Local Setup

If you need to deploy manually without the script:

```bash
# Build the application
npm run build:client

# Navigate to build output
cd dist/public

# Initialize git and deploy
git init
git add -A
git commit -m "Deploy to GitHub Pages"
git remote add origin YOUR_REPO_URL
git push -f origin HEAD:gh-pages
```

## 🛠️ Development

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build:client

# Type checking
npm run check
```

### Project Structure

```
mehyar-web/
├── client/                 # React application source
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── pages/          # Page components
│   │   ├── data/           # Static data files
│   │   └── assets/         # Images and static assets
│   └── index.html          # HTML template
├── scripts/                # Deployment scripts
│   └── deploy-pages.ts     # GitHub Pages deployment script
├── .github/workflows/      # GitHub Actions workflows
│   └── deploy.yml          # Auto-deployment workflow
└── dist/public/           # Build output (generated)
```

## 🔧 Configuration

### GitHub Pages Base Path

The application is configured to work with GitHub Pages URL structure (`/mehyar-web/`). The base path is automatically set in production builds via `vite.config.ts`:

```typescript
base: process.env.NODE_ENV === "production" ? "/mehyar-web/" : "/"
```

### Environment Variables

No environment variables are required for basic deployment. The site uses static data embedded in the application.

## 📝 Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build:client` | Build client-only (for GitHub Pages) |
| `npm run build` | Build full-stack application |
| `npm run deploy:pages` | Deploy to GitHub Pages (build separately) |
| `npm run deploy:pages:local` | Build and deploy to GitHub Pages |
| `npm run check` | Type checking |

## 🔍 Troubleshooting

### Build Issues
- Ensure all dependencies are installed: `npm install`
- Check Node.js version (18+ required)
- Clear `node_modules` and reinstall if needed

### Deployment Issues
- Verify GitHub Pages is enabled in repository settings
- Check that the repository name matches the base path in `vite.config.ts`
- Ensure GitHub Actions has necessary permissions

### 404 Errors on GitHub Pages
- Verify the base path configuration matches your repository name
- Check that all routes are properly configured for single-page application routing

## 🌟 Features

- **Modern React Stack**: Built with React 18, TypeScript, and Vite
- **Responsive Design**: Mobile-first approach with Tailwind CSS
- **Component Library**: Shadcn/ui components for consistent UI
- **Dark Mode**: Built-in theme switching
- **SEO Optimized**: Proper meta tags and semantic HTML
- **Performance**: Optimized builds with code splitting

## 📄 License

MIT License - feel free to use this code for your own projects.

---

For questions or support, please open an issue in this repository.

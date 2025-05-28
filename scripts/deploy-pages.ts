#!/usr/bin/env tsx

/**
 * GitHub Pages Deployment Script
 * 
 * This script automates the deployment of the React application to GitHub Pages.
 * It can be run locally or as part of CI/CD pipeline.
 * 
 * Usage:
 *   npm run deploy:pages
 *   or
 *   tsx scripts/deploy-pages.ts
 */

import { execSync } from 'child_process';
import { existsSync, rmSync } from 'fs';
import path from 'path';

const REPO_NAME = 'mehyar-web';
const DIST_DIR = './dist/public';
const BUILD_SCRIPT = 'npm run build';

interface DeployConfig {
  repoName: string;
  distDir: string;
  buildScript: string;
  branch: string;
  remote: string;
}

const config: DeployConfig = {
  repoName: REPO_NAME,
  distDir: DIST_DIR,
  buildScript: BUILD_SCRIPT,
  branch: 'gh-pages',
  remote: 'origin'
};

class GitHubPagesDeployer {
  private config: DeployConfig;

  constructor(config: DeployConfig) {
    this.config = config;
  }

  private log(message: string, color: 'green' | 'blue' | 'yellow' | 'red' = 'blue') {
    const colors = {
      green: '\x1b[32m',
      blue: '\x1b[34m',
      yellow: '\x1b[33m',
      red: '\x1b[31m',
      reset: '\x1b[0m'
    };
    console.log(`${colors[color]}[DEPLOY]${colors.reset} ${message}`);
  }

  private exec(command: string, options: { cwd?: string; stdio?: 'inherit' | 'pipe' } = {}) {
    this.log(`Executing: ${command}`, 'yellow');
    try {
      return execSync(command, {
        encoding: 'utf8',
        stdio: options.stdio || 'inherit',
        cwd: options.cwd || process.cwd(),
        ...options
      });
    } catch (error) {
      this.log(`Command failed: ${command}`, 'red');
      throw error;
    }
  }

  private checkPrerequisites() {
    this.log('Checking prerequisites...');
    
    // Check if git is available
    try {
      this.exec('git --version', { stdio: 'pipe' });
    } catch {
      throw new Error('Git is not installed or not available in PATH');
    }

    // Check if we're in a git repository
    try {
      this.exec('git rev-parse --git-dir', { stdio: 'pipe' });
    } catch {
      throw new Error('Current directory is not a Git repository');
    }

    // Check if npm is available
    try {
      this.exec('npm --version', { stdio: 'pipe' });
    } catch {
      throw new Error('npm is not installed or not available in PATH');
    }

    this.log('Prerequisites check passed!', 'green');
  }

  private buildApplication() {
    this.log('Building application...');
    
    // Set production environment
    process.env.NODE_ENV = 'production';
    
    // Clean previous build
    if (existsSync(this.config.distDir)) {
      this.log('Cleaning previous build...');
      rmSync(this.config.distDir, { recursive: true, force: true });
    }

    // Run build command
    this.exec(this.config.buildScript);

    // Verify build output exists
    if (!existsSync(this.config.distDir)) {
      throw new Error(`Build output directory not found: ${this.config.distDir}`);
    }

    this.log('Application built successfully!', 'green');
  }

  private deployToGitHubPages() {
    this.log('Deploying to GitHub Pages...');
    
    const distPath = path.resolve(this.config.distDir);
    
    // Navigate to dist directory
    process.chdir(distPath);
    
    try {
      // Initialize git repository in dist
      this.exec('git init');
      
      // Configure git user (use GitHub Actions bot if available)
      const gitUser = process.env.GITHUB_ACTOR || 'GitHub Pages Bot';
      const gitEmail = process.env.GITHUB_ACTOR ? 
        `${process.env.GITHUB_ACTOR}@users.noreply.github.com` : 
        'github-pages-bot@users.noreply.github.com';
      
      this.exec(`git config user.name "${gitUser}"`);
      this.exec(`git config user.email "${gitEmail}"`);
      
      // Add all files
      this.exec('git add -A');
      
      // Create commit
      const timestamp = new Date().toISOString();
      this.exec(`git commit -m "Deploy to GitHub Pages - ${timestamp}"`);
      
      // Get the remote URL
      process.chdir('..');
      process.chdir('..');
      const remoteUrl = this.exec('git config --get remote.origin.url', { stdio: 'pipe' })?.toString().trim();
      
      if (!remoteUrl) {
        throw new Error('Could not determine remote repository URL');
      }
      
      // Navigate back to dist
      process.chdir(distPath);
      
      // Add remote and push
      this.exec(`git remote add ${this.config.remote} ${remoteUrl}`);
      this.exec(`git push -f ${this.config.remote} HEAD:${this.config.branch}`);
      
    } finally {
      // Navigate back to project root
      process.chdir('..');
      process.chdir('..');
    }

    this.log('Deployment completed successfully!', 'green');
  }

  private showCompletionMessage() {
    this.log('🎉 Deployment Summary:', 'green');
    console.log('');
    console.log(`✅ Application built and deployed to GitHub Pages`);
    console.log(`📦 Repository: ${this.config.repoName}`);
    console.log(`🌐 Your site will be available at:`);
    console.log(`   https://YOUR_USERNAME.github.io/${this.config.repoName}/`);
    console.log('');
    console.log('Note: It may take a few minutes for changes to be visible.');
    console.log('You can check the deployment status in your repository\'s Actions tab.');
  }

  async deploy() {
    try {
      this.log('Starting GitHub Pages deployment...');
      
      this.checkPrerequisites();
      this.buildApplication();
      this.deployToGitHubPages();
      this.showCompletionMessage();
      
    } catch (error) {
      this.log(`Deployment failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'red');
      process.exit(1);
    }
  }
}

// Run deployment if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const deployer = new GitHubPagesDeployer(config);
  deployer.deploy();
}

export { GitHubPagesDeployer, type DeployConfig };

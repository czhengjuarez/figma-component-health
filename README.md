# Figma Component Enterprise Analytics

A comprehensive tool for analyzing Figma component libraries with enterprise-grade analytics, providing health metrics, usage insights, team adoption data, and exportable reports for design system management.

**Last Updated**: August 16, 2025

## 🚀 Features

### Core Analytics
- **Component Inventory Analysis**: Analyze any Figma file to get a complete component inventory
- **Health Scoring**: Intelligent scoring based on documentation quality, usage patterns, and maintenance status
- **Hierarchical Display**: Organized view with base components and expandable variants
- **CSV Export**: Download detailed reports for further analysis and team sharing
- **Real-time Thumbnails**: Visual component previews directly from Figma

### Enterprise Analytics (Figma Enterprise Plans)
- **Usage Trends**: 4-week historical data showing component insertion/detachment patterns
- **Team Adoption Metrics**: Track which teams are using components and adoption percentages
- **Library Analytics Integration**: Real-time data from Figma's Library Analytics API
- **Adoption Rate Calculation**: Percentage of components actively being used across files
- **Active Team Tracking**: Monitor component usage across different teams (excluding drafts)
- **Weekly vs Total Metrics**: Compare current week activity against 4-week totals

### Technical Features
- **Unified Worker Architecture**: Single Cloudflare Worker handling both frontend and API
- **Dual API Support**: Standard Figma API for all users, Library Analytics API for Enterprise
- **Component Validation**: Automatic detection of published component libraries
- **Error Handling**: Detailed error messages with actionable guidance
- **Professional UI**: Clean, modern interface with intuitive navigation

## 🛠 Tech Stack

- **Frontend**: React + TypeScript + Tailwind CSS v3
- **Backend**: Cloudflare Workers (unified deployment)
- **APIs**: Figma REST API v1 + Library Analytics API (Enterprise)
- **Icons**: Lucide React
- **Build Tool**: Vite
- **Deployment**: Cloudflare Workers

## 📋 Prerequisites

- Node.js 18+ and npm
- Cloudflare account (for deployment)
- Figma Personal Access Token (with appropriate scopes)
- Figma file viewing permissions
- Figma Enterprise plan (for Library Analytics features)

## 🚀 Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd figma-components
npm install
cd backend
npm install
      },
      // other options...
    },
  },
])
```

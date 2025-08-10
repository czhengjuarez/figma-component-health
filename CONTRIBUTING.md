# Contributing to Figma Component Health Reporter

Thank you for your interest in contributing to the Figma Component Health Reporter! This document provides guidelines and information for contributors.

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ and npm
- Cloudflare account (for deployment testing)
- Basic knowledge of React, TypeScript, and Cloudflare Workers

### Development Setup

1. **Fork and Clone**
   ```bash
   git clone https://github.com/YOUR_USERNAME/figma-component-health.git
   cd figma-component-health
   ```

2. **Install Dependencies**
   ```bash
   npm install
   cd backend
   npm install
   ```

3. **Start Development Servers**
   ```bash
   # Terminal 1: Frontend (port 3000)
   npm run dev
   
   # Terminal 2: Backend
   cd backend
   npm run dev
   ```

## 🏗 Project Structure

```
figma-components/
├── backend/
│   ├── unified-worker.js    # Main Cloudflare Worker
│   ├── wrangler.toml       # Cloudflare config
│   └── package.json        # Backend dependencies
├── src/                    # Frontend source (development only)
├── .github/workflows/      # GitHub Actions
└── README.md
```

## 🛠 Development Guidelines

### Code Style
- Use TypeScript for type safety
- Follow existing code formatting and structure
- Use meaningful variable and function names
- Add comments for complex logic

### Component Guidelines
- Keep components focused and single-purpose
- Use proper TypeScript interfaces
- Handle loading and error states
- Follow existing UI patterns

### API Guidelines
- Maintain backward compatibility
- Add proper error handling
- Document new endpoints
- Test with various Figma file types

## 🧪 Testing

### Manual Testing
1. Test with different Figma files (small, large, library files)
2. Verify CSV export functionality
3. Check responsive design on different screen sizes
4. Test error handling with invalid tokens/file keys

### Deployment Testing
```bash
cd backend
wrangler deploy --dry-run  # Test deployment without publishing
```

## 📝 Pull Request Process

1. **Create Feature Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make Changes**
   - Write clear, focused commits
   - Test your changes thoroughly
   - Update documentation if needed

3. **Submit Pull Request**
   - Use descriptive title and description
   - Reference any related issues
   - Include screenshots for UI changes
   - Ensure CI passes

### PR Checklist
- [ ] Code follows existing style and conventions
- [ ] Changes are tested manually
- [ ] Documentation updated (if applicable)
- [ ] No breaking changes (or clearly documented)
- [ ] Deployment tested (if applicable)

## 🐛 Bug Reports

When reporting bugs, please include:

- **Environment**: Browser, OS, device type
- **Steps to Reproduce**: Clear, numbered steps
- **Expected Behavior**: What should happen
- **Actual Behavior**: What actually happens
- **Screenshots**: If applicable
- **Figma File Details**: File size, component count (if relevant)

## 💡 Feature Requests

For new features, please provide:

- **Use Case**: Why is this feature needed?
- **Proposed Solution**: How should it work?
- **Alternatives**: Other ways to solve the problem
- **Impact**: Who would benefit from this feature?

## 🔧 Architecture Notes

### Frontend Architecture
- React components with TypeScript
- Tailwind CSS for styling
- Lucide React for icons
- State management via React hooks

### Backend Architecture
- Unified Cloudflare Worker serving both API and frontend
- Figma REST API integration
- No persistent storage (stateless)
- CORS-enabled for cross-origin requests

### Deployment
- Single unified worker deployment
- Environment variables via Wrangler
- GitHub Actions for CI/CD
- Cloudflare Workers platform

## 🤝 Community Guidelines

- Be respectful and inclusive
- Provide constructive feedback
- Help others learn and grow
- Follow the code of conduct

## 📞 Getting Help

- **Issues**: Use GitHub Issues for bugs and feature requests
- **Discussions**: Use GitHub Discussions for questions and ideas
- **Documentation**: Check README.md and inline code comments

## 🎯 Areas for Contribution

### High Priority
- Performance optimizations
- Error handling improvements
- Additional export formats (JSON, Excel)
- Enhanced component health metrics

### Medium Priority
- UI/UX improvements
- Mobile responsiveness enhancements
- Additional Figma API integrations
- Accessibility improvements

### Low Priority
- Additional themes/styling options
- Advanced filtering and search
- Component usage analytics (Enterprise API)
- Integration with other design tools

Thank you for contributing to make Figma Component Health Reporter better for everyone! 🎉

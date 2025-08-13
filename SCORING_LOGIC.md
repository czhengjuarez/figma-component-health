# Figma Component Health Reporter - Scoring Logic Documentation

## Overview

The Figma Component Health Reporter uses a comprehensive scoring system that evaluates components across multiple dimensions to provide a health score from 0-100. The scoring combines base health metrics with advanced WCAG contrast analysis for a complete accessibility and quality assessment.

**This documentation reflects the unified scoring system deployed across all environments (local, figma-component-health-ent, and figma-component-health) as of the latest standardization update.**

## Base Health Score Calculation

### Starting Score
- **Base Score**: 100 points
- All components start with a perfect score and points are deducted or added based on various criteria.

### Comprehensive Scoring System

The unified worker uses a sophisticated multi-tier penalty and bonus system:

## Critical Issues (-50 points each)

### 1. Deprecated Status
- **Deprecated Components**: -50 points
- Components marked as deprecated receive the highest penalty as they should be phased out immediately.

### 2. Broken Layout/Constraints
- **Invalid Dimensions**: -50 points
- Components with `absoluteBoundingBox` width or height ≤ 0 indicate broken auto-layout or constraints.

### 3. Accessibility Violations
- **Critical Accessibility Issues**: -50 points
- Interactive components (buttons, inputs, links) without accessibility information and relying on color-only indicators.

## Major Issues (-25 points each)

### 4. Poor Documentation
- **Missing or Insufficient Documentation**: -25 points
- Components without descriptions or with descriptions < 10 characters.

### 5. Missing Key Variants
- **Incomplete Variant Coverage**: -25 points
- Components lacking common interaction states (hover, disabled, active, focus, default) or proper variant patterns (= or / naming).

## Minor Issues (-10 points each)

### 6. Naming Convention Violations
- **Poor Naming Standards**: -10 points
- Components not following proper naming conventions: `^[A-Z][a-zA-Z0-9]*(\s*[\/=]\s*[A-Z][a-zA-Z0-9]*)*$`

### 7. Missing Thumbnails
- **No Visual Preview**: -10 points
- Components without `thumbnail_url` or with placeholder thumbnails.

### 8. Inconsistent Property Patterns
- **Mixed Naming Styles**: -10 points
- Components using both `=` and `/` patterns inconsistently within the same component name.

## Bonus Points (+10 points each)

### 9. Excellent Documentation with Examples
- **Rich Documentation**: +10 points
- Components with descriptions > 50 characters containing "example" or "usage" keywords.

### 10. Design System Pattern Recognition
- **Consistent Design Patterns**: +10 points
- Components following standard design system naming (Button, Input, Card, Icon, Badge, Alert) with proper variants.

### 11. Well-Documented Library Components
- **Library Component Excellence**: +10 points
- Library components with descriptions > 30 characters indicating good adoption potential.

### 12. Component Completeness
- **Structural Excellence**: +10 points
- Components with descriptions > 20 characters AND proper `absoluteBoundingBox` dimensions (width > 0, height > 0).

### 13. Accessibility Excellence
- **Superior Accessibility**: +10 points
- Components with excellent accessibility implementation including ARIA, screen reader, or WCAG references.

## Scoring Implementation

### Accessibility Compliance Check
```javascript
function checkAccessibilityCompliance(component) {
  const name = component.name.toLowerCase();
  const description = (component.description || '').toLowerCase();
  
  const hasColorOnlyInfo = name.includes('red') || name.includes('green') || name.includes('color');
  const lacksAriaInfo = !description.includes('aria') && !description.includes('accessible') && !description.includes('screen reader');
  const hasInteraction = name.includes('button') || name.includes('input') || name.includes('link');
  
  return hasInteraction && lacksAriaInfo && hasColorOnlyInfo;
}
```

### Accessibility Excellence Check
```javascript
function checkAccessibilityExcellence(component) {
  const description = (component.description || '').toLowerCase();
  return description.includes('aria') || description.includes('accessible') || 
         description.includes('screen reader') || description.includes('wcag');
}
```

### Complete Scoring Function
```javascript
function calculateHealthScore(component, instanceCount, isDeprecated, isLibraryFile = true) {
  let score = 100; // Base Score: 100 points
  
  // CRITICAL ISSUES (-50 points each)
  if (isDeprecated) score -= 50;
  if (component.absoluteBoundingBox && (component.absoluteBoundingBox.width <= 0 || component.absoluteBoundingBox.height <= 0)) score -= 50;
  if (checkAccessibilityCompliance(component)) score -= 50;
  
  // MAJOR ISSUES (-25 points each)
  if (!component.description || component.description.trim().length < 10) score -= 25;
  
  const hasVariants = component.name.includes('=') || component.name.includes('/');
  const commonVariants = ['hover', 'disabled', 'active', 'focus', 'default'];
  const hasCommonVariants = commonVariants.some(variant => component.name.toLowerCase().includes(variant));
  if (!hasVariants && !hasCommonVariants) score -= 25;
  
  // MINOR ISSUES (-10 points each)
  if (!/^[A-Z][a-zA-Z0-9]*(\s*[\/=]\s*[A-Z][a-zA-Z0-9]*)*$/.test(component.name)) score -= 10;
  if (!component.thumbnail_url || component.thumbnail_url.includes('placeholder')) score -= 10;
  if (component.name.includes('=') && component.name.includes('/')) score -= 10;
  
  // BONUS POINTS (+10 points each)
  if (component.description && component.description.length > 50 && (component.description.includes('example') || component.description.includes('usage'))) score += 10;
  if (component.name.match(/^(Button|Input|Card|Icon|Badge|Alert)/) && hasVariants) score += 10;
  if (isLibraryFile && component.description && component.description.length > 30) score += 10;
  if (component.description && component.description.length > 20 && component.absoluteBoundingBox && component.absoluteBoundingBox.width > 0 && component.absoluteBoundingBox.height > 0) score += 10;
  if (!checkAccessibilityCompliance(component) && checkAccessibilityExcellence(component)) score += 10;
  
  return Math.max(0, Math.min(100, score));
}
```

## WCAG Contrast Analysis Enhancement

### Color Analysis Process

#### 1. Thumbnail Processing
- Components with thumbnail URLs undergo automated color analysis
- Canvas-based pixel extraction identifies dominant colors
- Colors are grouped into 32-color buckets for efficiency
- Only non-transparent pixels (alpha > 128) are analyzed

#### 2. Contrast Ratio Calculation
Uses WCAG 2.1 standard luminance formula:
```javascript
const calculateLuminance = (r, g, b) => {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
};

const calculateContrastRatio = (color1, color2) => {
  const lum1 = calculateLuminance(color1.r, color1.g, color1.b);
  const lum2 = calculateLuminance(color2.r, color2.g, color2.b);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
};
```

#### 3. WCAG Compliance Scoring
Based on minimum contrast ratio between dominant colors:

- **WCAG AAA Compliance**: +15 points
  - Minimum contrast ratio ≥ 7.0:1
  - Highest accessibility standard

- **WCAG AA Compliance**: +10 points  
  - Minimum contrast ratio ≥ 4.5:1
  - Standard accessibility requirement

- **WCAG AA Large Text**: +5 points
  - Minimum contrast ratio ≥ 3.0:1
  - Acceptable for large text elements

- **Contrast Failure**: -25 points
  - Minimum contrast ratio < 3.0:1
  - Below WCAG accessibility standards

### Contrast Analysis Logic
```javascript
let contrastAdjustment = 0;

if (contrastData.wcagAAA && contrastData.minContrast >= 7.0) {
  contrastAdjustment += 15; // AAA compliance
} else if (contrastData.wcagAA && contrastData.minContrast >= 4.5) {
  contrastAdjustment += 10; // AA compliance  
} else if (contrastData.wcagAALarge && contrastData.minContrast >= 3.0) {
  contrastAdjustment += 5; // Large text compliance
} else if (contrastData.minContrast < 3.0) {
  contrastAdjustment -= 25; // Contrast failure
}

const finalScore = Math.max(0, Math.min(100, baseScore + contrastAdjustment));
```

## Final Score Calculation

### Score Bounds
- **Minimum Score**: 0 points
- **Maximum Score**: 100 points
- Scores are clamped to this range regardless of adjustments

### Calculation Flow
1. **Start**: 100 points
2. **Apply Deprecation Penalty**: -50 if deprecated
3. **Apply Usage Penalty**: -30 if unused (non-library only)
4. **Apply Documentation Scoring**: -25 to +20 based on documentation quality
5. **Apply WCAG Contrast Analysis**: -25 to +15 based on accessibility compliance
6. **Clamp Result**: Ensure final score is between 0-100

## Component Grouping and Aggregation

### Hierarchical Grouping
Components are grouped by base name patterns:
- **Slash Pattern**: "Icon / Arrow / Refresh" → base: "Icon"
- **Equals Pattern**: "Property 1=North South" → base: "Property 1"
- **Standalone**: "Button" → base: "Button"

### Variant Aggregation
For component groups with variants:
- **Base Health Score**: Average of all variant scores
- **Usage Count**: Sum of all variant usage
- **Deprecation Status**: True if ANY variant is deprecated
- **Orphaned Status**: True only if ALL variants are orphaned
- **Thumbnail**: Uses first available variant thumbnail

## Export Data Structure

### CSV Export Columns
1. **Component Name**: Full component name
2. **Type**: "Component" or "Component Set"
3. **Instances**: Usage count
4. **Health Score**: Final calculated score (0-100%)
5. **WCAG Compliance**: "AAA", "AA", "AA Large", "Poor", or "Not Analyzed"
6. **Contrast Ratio**: Minimum contrast ratio (e.g., "4.52")
7. **Status**: "Active", "Deprecated", "Unused"
8. **Description**: Component description text
9. **Variants**: Number of variants
10. **Page**: Page location in Figma file

## Performance Considerations

### Batch Processing
- Components are analyzed in batches with progress tracking
- 100ms delay every 5 components to prevent browser blocking
- Real-time progress updates with current/total counts

### Error Handling
- Failed thumbnail analysis doesn't block other components
- Components without thumbnails skip contrast analysis
- CORS and image loading errors are gracefully handled

### Caching
- Thumbnail analysis results are cached per component
- Dominant color extraction is optimized with color bucketing
- Canvas operations are cleaned up to prevent memory leaks

## UI Indicators

### Health Score Badges
- **Green (80-100%)**: Excellent health
- **Yellow (60-79%)**: Good health  
- **Red (0-59%)**: Poor health

### WCAG Compliance Badges
- **AAA**: Green badge for excellent contrast
- **AA**: Yellow badge for good contrast
- **AA+**: Orange badge for large text compliance
- **⚠**: Red badge for poor contrast

This scoring system provides a comprehensive evaluation of component quality, combining traditional metrics with modern accessibility standards for a complete health assessment.

# Figma Component Health Reporter - Scoring Logic Documentation

## Overview

The Figma Component Health Reporter uses a comprehensive scoring system that evaluates components across multiple dimensions to provide a health score from 0-100. The scoring combines base health metrics with advanced WCAG contrast analysis for a complete accessibility and quality assessment.

## Base Health Score Calculation

### Starting Score
- **Base Score**: 100 points
- All components start with a perfect score and points are deducted or added based on various criteria.

### Core Penalties and Bonuses

#### 1. Deprecation Status
- **Deprecated Components**: -50 points
- Components marked as deprecated receive a significant penalty as they should be phased out.

#### 2. Usage-Based Scoring (Non-Library Files Only)
- **Unused Components**: -30 points (only for non-library files)
- Library components are exempt from usage penalties since they're meant to be used across other files/teams.

#### 3. Documentation Scoring

##### Documentation Penalties
- **No Documentation**: -25 points
- Components without descriptions or with empty descriptions receive a penalty.

##### Documentation Bonuses
- **Rich Documentation**: +10 points
  - Criteria: 50+ characters AND contains keywords like "example", "usage", or "use"
  - Rewards comprehensive documentation with usage examples

- **Library Component Documentation**: +10 points
  - Criteria: Library components with 30+ character descriptions
  - Extra credit for well-documented library components

##### Documentation Evaluation Logic
```javascript
const description = component.description || '';
const descLength = description.trim().length;

if (descLength === 0) {
  score -= 25; // Penalty for no documentation
} else if (descLength >= 10) {
  // Basic documentation exists (avoids penalty)
  if (descLength >= 50 && (description.includes('example') || 
                          description.includes('usage') || 
                          description.includes('use'))) {
    score += 10; // Rich documentation with examples/usage
  }
  if (isLibraryFile && descLength >= 30) {
    score += 10; // Extra credit for library components with good docs
  }
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

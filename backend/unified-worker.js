// Unified Cloudflare Worker for Figma Component Health
// Serves both API endpoints and static frontend files

// Helper function to make Figma API requests
async function figmaApiRequest(endpoint, token) {
  try {
    console.log(`Making request to: https://api.figma.com/v1${endpoint}`);
    const response = await fetch(`https://api.figma.com/v1${endpoint}`, {
      headers: {
        'X-Figma-Token': token,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Figma API error: ${response.status} - ${errorText}`);
      throw new Error(`Figma API error: ${response.status} - ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Figma API request failed:', error);
    throw error;
  }
}

// Helper function to calculate component health score
function calculateHealthScore(component, instanceCount, isDeprecated, isLibraryFile = true) {
  let score = 100;
  
  // Penalize deprecated components
  if (isDeprecated) score -= 50;
  
  // For library files, don't penalize for low usage within the same file
  // since components are meant to be used across other files/teams
  if (!isLibraryFile && instanceCount === 0) {
    score -= 30; // Only penalize unused components in non-library files
  }
  
  // Penalize components without descriptions (documentation is important for libraries)
  if (!component.description || component.description.trim() === '') score -= 15;
  
  // For library files, give bonus for having good documentation instead of usage
  if (isLibraryFile && component.description && component.description.length > 20) {
    score += 10; // Bonus for well-documented library components
  } else if (!isLibraryFile && instanceCount > 5) {
    score += 10; // Bonus for well-used components in regular files
  }
  
  return Math.max(0, Math.min(100, score));
}

// Helper function to check if component is deprecated
function isComponentDeprecated(component) {
  const name = component.name.toLowerCase();
  const description = (component.description || '').toLowerCase();
  
  return name.includes('deprecated') || 
         name.includes('old') || 
         name.includes('legacy') ||
         description.includes('deprecated') ||
         description.includes('do not use') ||
         description.includes('obsolete');
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

// Handle CORS preflight requests
function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

// Handle analyze request
async function handleAnalyze(request, env) {
  try {
    const body = await request.json();
    const { figmaToken, fileKeys } = body;
    
    console.log('Request body:', JSON.stringify(body, null, 2));
    
    if (!figmaToken || !fileKeys) {
      return new Response(JSON.stringify({ error: 'Missing figmaToken or fileKeys' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Handle both string and array inputs for fileKeys
    const fileKeyArray = Array.isArray(fileKeys) ? fileKeys : [fileKeys];
    const results = [];

    for (const fileKey of fileKeyArray) {
      console.log(`Analyzing file: ${fileKey}`);
      
      try {
        // Get components directly using the components endpoint
        const componentsData = await figmaApiRequest(`/files/${fileKey}/components`, figmaToken);
        
        if (!componentsData.meta || !componentsData.meta.components) {
          console.log('No components found in file');
          results.push({
            fileKey,
            fileName: 'Unknown File',
            components: [],
            summary: {
              totalComponents: 0,
              wellDocumented: 0,
              deprecatedComponents: 0,
              recentUpdates: 0
            }
          });
          continue;
        }

        const components = Object.values(componentsData.meta.components).map(component => {
          const isDeprecated = isComponentDeprecated(component);
          const instanceCount = 0; // Hardcoded since we can't get real usage data
          const healthScore = calculateHealthScore(component, instanceCount, isDeprecated, true);
          
          return {
            name: component.name,
            description: component.description || '',
            usageCount: instanceCount,
            isOrphaned: instanceCount === 0,
            isDeprecated,
            healthScore,
            type: 'COMPONENT',
            variants: 0,
            pageName: 'Components',
            thumbnail_url: component.thumbnail_url || null,
            lastModified: component.updated_at || new Date().toISOString(),
            firstUsed: component.created_at || new Date().toISOString()
          };
        });

        // Calculate summary statistics
        const totalComponents = components.length;
        const wellDocumented = components.filter(c => c.description && c.description.length > 10).length;
        const deprecatedComponents = components.filter(c => c.isDeprecated).length;
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const recentUpdates = components.filter(c => new Date(c.lastModified) > thirtyDaysAgo).length;

        results.push({
          fileKey,
          fileName: `File ${fileKey.substring(0, 8)}...`,
          components,
          summary: {
            totalComponents,
            wellDocumented,
            deprecatedComponents,
            recentUpdates
          }
        });

      } catch (fileError) {
        console.error(`Error analyzing file ${fileKey}:`, fileError);
        results.push({
          fileKey,
          fileName: 'Error',
          components: [],
          summary: {
            totalComponents: 0,
            wellDocumented: 0,
            deprecatedComponents: 0,
            recentUpdates: 0
          },
          error: fileError.message
        });
      }
    }

    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Analysis error:', error);
    return new Response(JSON.stringify({ 
      error: error.message || 'Failed to analyze Figma file' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Handle health check
function handleHealth() {
  return new Response(JSON.stringify({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'Figma Component Health - Unified Worker'
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Self-contained HTML with inline styles and CDN React
const HTML_TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Figma Component Health</title>
    <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      tailwind.config = {
        theme: {
          extend: {
            colors: {
              primary: {
                50: '#fdf2f8',
                100: '#fce7f3',
                200: '#fbcfe8',
                300: '#f9a8d4',
                400: '#f472b6',
                500: '#8F1F57',
                600: '#7c1d4f',
                700: '#701a47',
                800: '#64173f',
                900: '#581537',
              }
            }
          }
        }
      }
    </script>
    <style>
      .btn-primary-enhanced {
        background-color: #8F1F57;
        color: white;
        font-weight: 500;
        padding: 0.5rem 1rem;
        border-radius: 0.375rem;
        box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
        transition: all 0.2s;
      }
      .btn-primary-enhanced:hover {
        background-color: #7c1d4f;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      }
      .btn-primary-enhanced:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .btn-secondary-enhanced {
        background-color: white;
        color: #374151;
        font-weight: 500;
        padding: 0.5rem 1rem;
        border: 1px solid #d1d5db;
        border-radius: 0.375rem;
        box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
        transition: all 0.2s;
      }
      .btn-secondary-enhanced:hover {
        background-color: #f9fafb;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      }
      .card-enhanced {
        background-color: white;
        border-radius: 0.5rem;
        border: 1px solid #e5e7eb;
        box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
        transition: box-shadow 0.2s;
      }
      .card-enhanced:hover {
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      }
    </style>
  </head>
  <body class="min-h-screen bg-gray-50">
    <div id="root"></div>
    <script type="text/babel">
      const { useState } = React;
      
      function App() {
        const [componentData, setComponentData] = useState([]);
        const [isLoading, setIsLoading] = useState(false);
        const [error, setError] = useState('');
        const [figmaToken, setFigmaToken] = useState('');
        const [fileKey, setFileKey] = useState('');
        const [expandedGroups, setExpandedGroups] = useState(new Set());
        const [showTokenTooltip, setShowTokenTooltip] = useState(false);
        const [showFileKeyTooltip, setShowFileKeyTooltip] = useState(false);
        
        // Component grouping logic - handles hierarchical categorization
        const groupComponents = (components) => {
          const groups = {};
          
          components.forEach(component => {
            let baseName;
            let isVariant = false;
            
            // Handle different naming patterns:
            // 1. "Icon / Arrow / Refresh" -> base: "Icon"
            // 2. "Property 1=North South" -> base: "Property 1"  
            // 3. "Type=Grabbed" -> base: "Type"
            // 4. "Button" -> base: "Button" (standalone)
            
            if (component.name.includes(' / ')) {
              // Pattern: "Icon / Arrow / Refresh"
              const parts = component.name.split(' / ');
              baseName = parts[0];
              isVariant = parts.length > 1;
            } else if (component.name.includes('=')) {
              // Pattern: "Property 1=North South" or "Type=Grabbed"
              const parts = component.name.split('=');
              baseName = parts[0];
              isVariant = parts.length > 1;
            } else {
              // Standalone component
              baseName = component.name;
              isVariant = false;
            }
            
            if (!groups[baseName]) {
              // Create base component entry
              groups[baseName] = {
                base: {
                  ...component,
                  name: baseName,
                  description: component.description || '',
                  healthScore: component.healthScore || 0,
                  isDeprecated: component.isDeprecated || false,
                  isOrphaned: component.isOrphaned || false,
                  usageCount: component.usageCount || 0,
                  thumbnail_url: component.thumbnail_url
                },
                variants: []
              };
            }
            
            if (isVariant) {
              // This is a variant, add to variants array
              let variantName;
              if (component.name.includes(' / ')) {
                variantName = component.name.split(' / ').slice(1).join(' / ');
              } else if (component.name.includes('=')) {
                variantName = component.name.split('=').slice(1).join('=');
              } else {
                variantName = component.name;
              }
              
              groups[baseName].variants.push({
                ...component,
                name: variantName
              });
              
              // Update base component stats based on variants
              const group = groups[baseName];
              
              // Aggregate health score (average of all variants)
              const avgHealth = group.variants.reduce((sum, v) => sum + (v.healthScore || 0), 0) / group.variants.length;
              group.base.healthScore = Math.round(avgHealth);
              
              // Aggregate usage count (sum of all variants)
              group.base.usageCount = group.variants.reduce((sum, v) => sum + (v.usageCount || 0), 0);
              
              // Base is deprecated if any variant is deprecated
              group.base.isDeprecated = group.variants.some(v => v.isDeprecated);
              
              // Base is orphaned only if ALL variants are orphaned
              group.base.isOrphaned = group.variants.every(v => v.isOrphaned);
              
              // Use the first variant's thumbnail for the base component if base doesn't have one
              if (!group.base.thumbnail_url && group.variants.length > 0) {
                const firstVariantWithThumbnail = group.variants.find(v => v.thumbnail_url);
                if (firstVariantWithThumbnail) {
                  group.base.thumbnail_url = firstVariantWithThumbnail.thumbnail_url;
                }
              }
            }
          });
          
          return groups;
        };
        
        const toggleGroup = (groupName) => {
          const newExpanded = new Set(expandedGroups);
          if (newExpanded.has(groupName)) {
            newExpanded.delete(groupName);
          } else {
            newExpanded.add(groupName);
          }
          setExpandedGroups(newExpanded);
        };
        
        const handleAnalyze = async () => {
          if (!figmaToken || !fileKey) {
            setError('Please enter both Figma Token and File Key');
            return;
          }
          
          setIsLoading(true);
          setError('');
          
          try {
            const response = await fetch('/api/analyze', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ figmaToken, fileKeys: fileKey })
            });
            
            if (!response.ok) {
              throw new Error(\`HTTP error! status: \${response.status}\`);
            }
            
            const data = await response.json();
            if (data.results && data.results[0] && data.results[0].components) {
              setComponentData(data.results[0].components);
            } else {
              setError('No components found in the file');
            }
          } catch (error) {
            setError(error.message || 'Failed to analyze Figma file');
          } finally {
            setIsLoading(false);
          }
        };
        
        const handleExportCSV = () => {
          if (componentData.length === 0) return;
          
          const groupedComponents = groupComponents(componentData);
          const csvData = [];
          
          // Add header
          csvData.push(['Component Name', 'Type', 'Description', 'Health Score', 'Status', 'Variants', 'Last Modified']);
          
          // Add data for each component group
          Object.entries(groupedComponents).forEach(([groupName, group]) => {
            // Add base component
            csvData.push([
              group.base.name,
              'Base Component',
              group.base.description || '',
              group.base.healthScore || 0,
              group.base.isDeprecated ? 'Deprecated' : 'Active',
              group.variants.length,
              group.base.lastModified || ''
            ]);
            
            // Add variants
            group.variants.forEach(variant => {
              csvData.push([
                variant.name,
                'Variant',
                variant.description || '',
                variant.healthScore || 0,
                variant.isDeprecated ? 'Deprecated' : 'Active',
                0,
                variant.lastModified || ''
              ]);
            });
          });
          
          // Convert to CSV string
          const newlineChar = String.fromCharCode(10); // ASCII code for newline
          const csvContent = csvData.map(row => 
            row.map(cell => '"' + String(cell).replace(/"/g, '""') + '"').join(',')
          ).join(newlineChar);
          
          // Create and download file
          const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'figma-component-health-report.csv';
          a.click();
          URL.revokeObjectURL(url);
        };
        
        // Calculate stats based on grouped components (base components only)
        const groupedComponents = groupComponents(componentData);
        const baseComponents = Object.values(groupedComponents).map(group => group.base);
        
        const totalComponents = baseComponents.length;
        const wellDocumented = baseComponents.filter(c => 
          c.description && c.description.trim().length > 10
        ).length;
        const deprecatedComponents = baseComponents.filter(c => c.isDeprecated).length;
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const recentUpdates = baseComponents.filter(c => {
          if (!c.lastModified) return false;
          const lastUpdate = new Date(c.lastModified);
          return lastUpdate > thirtyDaysAgo;
        }).length;
        
        return React.createElement('div', { className: 'min-h-screen bg-gray-50' },
          React.createElement('div', { className: 'bg-white shadow-sm border-b border-gray-200' },
            React.createElement('div', { className: 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6' },
              React.createElement('div', { className: 'flex items-center gap-3' },
                React.createElement('div', { className: 'p-2 bg-primary-500 rounded-lg' },
                  React.createElement('svg', { 
                    className: 'h-6 w-6 text-white', 
                    fill: 'none', 
                    stroke: 'currentColor', 
                    viewBox: '0 0 24 24' 
                  },
                    React.createElement('path', { 
                      strokeLinecap: 'round', 
                      strokeLinejoin: 'round', 
                      strokeWidth: 2, 
                      d: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4' 
                    })
                  )
                ),
                React.createElement('div', null,
                  React.createElement('h1', { className: 'text-2xl font-semibold text-gray-900' }, 'Figma Component Inventory & Health Reporter'),
                  React.createElement('p', { className: 'text-sm text-gray-600' }, 'Analyze component inventory, health, and structure across your Figma files')
                )
              )
            )
          ),
          React.createElement('div', { className: 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8' },
            React.createElement('div', { className: 'card-enhanced p-6 mb-8' },
              React.createElement('div', { className: 'mb-4' },
                React.createElement('div', { className: 'flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-md text-left' },
                  React.createElement('svg', { 
                    className: 'h-4 w-4 text-red-500 mt-0.5 flex-shrink-0', 
                    fill: 'none', 
                    stroke: 'currentColor', 
                    viewBox: '0 0 24 24' 
                  },
                    React.createElement('path', { 
                      strokeLinecap: 'round', 
                      strokeLinejoin: 'round', 
                      strokeWidth: 2, 
                      d: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' 
                    })
                  ),
                  React.createElement('div', { className: 'text-sm text-red-700' },
                    React.createElement('p', null,
                      React.createElement('strong', null, 'Note:'), ' You need viewing permissions (viewer, editor, or owner) for the Figma file to analyze it. The tool works with your own files, shared files, and public community files.'
                    )
                  )
                )
              ),
              React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-2 gap-4 mb-4' },
                React.createElement('div', null,
                  React.createElement('div', { className: 'flex items-center gap-2 mb-2' },
                    React.createElement('label', { className: 'block text-sm font-medium text-gray-700' }, 'Figma Personal Access Token'),
                    React.createElement('div', { className: 'relative' },
                      React.createElement('button', {
                        type: 'button',
                        onMouseEnter: () => setShowTokenTooltip(true),
                        onMouseLeave: () => setShowTokenTooltip(false),
                        className: 'text-gray-400 hover:text-gray-600 transition-colors'
                      },
                        React.createElement('svg', { className: 'h-4 w-4', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
                          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' })
                        )
                      ),
                      showTokenTooltip && React.createElement('div', { className: 'absolute bottom-full left-0 mb-2 w-80 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg z-10 text-left' },
                        React.createElement('div', { className: 'font-medium mb-2' }, 'How to get your Personal Access Token:'),
                        React.createElement('ol', { className: 'list-decimal list-inside space-y-1 text-left' },
                          React.createElement('li', null, 'Open Figma and go to your account settings'),
                          React.createElement('li', null, 'Navigate to "Personal Access Tokens"'),
                          React.createElement('li', null, 'Click "Create a new personal access token"'),
                          React.createElement('li', null, 'Give it a name and select "File content" scope'),
                          React.createElement('li', null, 'Copy the generated token (starts with "figd_")')
                        ),
                        React.createElement('div', { className: 'absolute top-full left-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900' })
                      )
                    )
                  ),
                  React.createElement('input', {
                    type: 'password',
                    value: figmaToken,
                    onChange: (e) => setFigmaToken(e.target.value),
                    className: 'w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500',
                    placeholder: 'figd_...'
                  }),
                  React.createElement('p', { className: 'text-xs text-gray-500 mt-1' }, 'Get your token from Figma Settings → Personal Access Tokens')
                ),
                React.createElement('div', null,
                  React.createElement('div', { className: 'flex items-center gap-2 mb-2' },
                    React.createElement('label', { className: 'block text-sm font-medium text-gray-700' }, 'Figma File Key(s)'),
                    React.createElement('div', { className: 'relative' },
                      React.createElement('button', {
                        type: 'button',
                        onMouseEnter: () => setShowFileKeyTooltip(true),
                        onMouseLeave: () => setShowFileKeyTooltip(false),
                        className: 'text-gray-400 hover:text-gray-600 transition-colors'
                      },
                        React.createElement('svg', { className: 'h-4 w-4', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
                          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' })
                        )
                      ),
                      showFileKeyTooltip && React.createElement('div', { className: 'absolute bottom-full left-0 mb-2 w-80 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg z-10 text-left' },
                        React.createElement('div', { className: 'font-medium mb-2' }, 'How to find your File Key:'),
                        React.createElement('ol', { className: 'list-decimal list-inside space-y-1 text-left' },
                          React.createElement('li', null, 'Open your Figma file in the browser'),
                          React.createElement('li', null, 'Look at the URL: figma.com/file/', React.createElement('strong', null, 'FILE_KEY'), '/file-name'),
                          React.createElement('li', null, 'Copy the alphanumeric string after "/file/"'),
                          React.createElement('li', null, 'For multiple files, separate keys with commas')
                        ),
                        React.createElement('div', { className: 'text-xs mt-2 text-gray-300 text-left' }, 'Example: abc123def456, xyz789uvw012'),
                        React.createElement('div', { className: 'absolute top-full left-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900' })
                      )
                    )
                  ),
                  React.createElement('input', {
                    type: 'text',
                    value: fileKey,
                    onChange: (e) => setFileKey(e.target.value),
                    className: 'w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500',
                    placeholder: 'abc123def456, xyz789uvw012 (comma-separated)'
                  }),
                  React.createElement('p', { className: 'text-xs text-gray-500 mt-1' }, 'Found in the Figma file URL. Separate multiple keys with commas.')
                )
              ),
              error && React.createElement('div', { className: 'mb-4 p-3 bg-red-50 border border-red-200 rounded-md' },
                React.createElement('p', { className: 'text-sm text-red-700' }, error)
              ),
              React.createElement('button', {
                onClick: handleAnalyze,
                disabled: isLoading,
                className: 'btn-primary-enhanced flex items-center gap-2'
              }, 
                isLoading ? [
                  React.createElement('div', { key: 'spinner', className: 'w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin' }),
                  'Analyzing Component Inventory...'
                ] : [
                  React.createElement('svg', { key: 'icon', className: 'h-4 w-4', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
                  ),
                  'Analyze Component Inventory'
                ]
              )
            ),
            

            
            // Summary Cards - separate from download button
            React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-4 gap-6 mb-6' },
                React.createElement('div', { className: 'card-enhanced p-6' },
                  React.createElement('div', { className: 'flex items-center justify-between' },
                    React.createElement('div', null,
                      React.createElement('p', { className: 'text-sm font-medium text-gray-600' }, 'Total Components'),
                      React.createElement('p', { className: 'text-2xl font-bold text-gray-900' }, componentData.length > 0 ? totalComponents : '--')
                    ),
                    React.createElement('svg', { className: 'h-5 w-5 text-gray-400', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
                      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' })
                    )
                  )
                ),
                React.createElement('div', { className: 'card-enhanced p-6' },
                  React.createElement('div', { className: 'flex items-center justify-between' },
                    React.createElement('div', null,
                      React.createElement('p', { className: 'text-sm font-medium text-gray-600' }, 'Well-Documented'),
                      React.createElement('p', { className: 'text-2xl font-bold text-green-600' }, componentData.length > 0 ? wellDocumented : '--')
                    ),
                    React.createElement('svg', { className: 'h-5 w-5 text-green-500', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
                      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' })
                    )
                  )
                ),
                React.createElement('div', { className: 'card-enhanced p-6' },
                  React.createElement('div', { className: 'flex items-center justify-between' },
                    React.createElement('div', null,
                      React.createElement('p', { className: 'text-sm font-medium text-gray-600' }, 'Deprecated Components'),
                      React.createElement('p', { className: 'text-2xl font-bold text-red-600' }, componentData.length > 0 ? deprecatedComponents : '--')
                    ),
                    React.createElement('svg', { className: 'h-5 w-5 text-red-500', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
                      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z' })
                    )
                  )
                ),
                React.createElement('div', { className: 'card-enhanced p-6' },
                  React.createElement('div', { className: 'flex items-center justify-between' },
                    React.createElement('div', null,
                      React.createElement('p', { className: 'text-sm font-medium text-gray-600' }, 'Recent Updates'),
                      React.createElement('p', { className: 'text-2xl font-bold text-primary-600' }, componentData.length > 0 ? recentUpdates : '--')
                    ),
                    React.createElement('svg', { className: 'h-5 w-5 text-pink-500', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
                      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6' })
                    )
                  )
                )
            ),
            
            // Download Button - positioned separately as shown in Image 2
            React.createElement('div', { className: 'flex justify-end mb-6' },
              React.createElement('button', {
                onClick: handleExportCSV,
                disabled: componentData.length === 0,
                className: 'btn-secondary-enhanced flex items-center gap-2' + (componentData.length === 0 ? ' opacity-50 cursor-not-allowed' : '')
              },
                React.createElement('svg', { className: 'h-4 w-4', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
                  React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4m4-5l5 5 5-5m-5 5V3' })
                ),
                'Export CSV'
              )
            ),
            React.createElement('div', { className: 'card-enhanced overflow-hidden' },
              React.createElement('div', { className: 'px-6 py-4 border-b border-gray-200' },
                React.createElement('h3', { className: 'text-lg font-semibold text-gray-900' }, 'Component Inventory'),
                React.createElement('div', { className: 'mt-3 p-3 bg-gray-50 border border-gray-200 rounded-md text-left' },
                  React.createElement('div', { className: 'flex items-start gap-2' },
                    React.createElement('svg', { 
                      className: 'h-4 w-4 text-gray-500 mt-0.5 flex-shrink-0', 
                      fill: 'none', 
                      stroke: 'currentColor', 
                      viewBox: '0 0 24 24' 
                    },
                      React.createElement('path', { 
                        strokeLinecap: 'round', 
                        strokeLinejoin: 'round', 
                        strokeWidth: 2, 
                        d: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' 
                      })
                    ),
                    React.createElement('div', { className: 'text-sm text-gray-700' },
                      React.createElement('p', { className: 'font-medium mb-1' }, 'Health Score Calculation'),
                      React.createElement('p', null, 'Health scores are based on component documentation quality, naming conventions, and maintenance status. Components start at 100% and lose points for missing descriptions (-15%), deprecated status (-50%), or poor documentation. Well-documented library components receive bonus points (+10%).'),
                      React.createElement('p', { className: 'mt-2 text-gray-600' },
                        React.createElement('strong', null, 'Enterprise Version:'), ' Includes cross-file usage analytics, team adoption metrics, and historical trends for more accurate health assessment.'
                      )
                    )
                  )
                )
              ),
              React.createElement('div', { className: 'overflow-x-auto' },
                React.createElement('table', { className: 'min-w-full divide-y divide-gray-200' },
                  React.createElement('thead', { className: 'bg-gray-50' },
                    React.createElement('tr', null,
                      React.createElement('th', { className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-8' }, 'Preview'),
                      React.createElement('th', { className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-48' }, 'Component Name'),
                      React.createElement('th', { className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20' }, 'Variants'),
                      React.createElement('th', { className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24' }, 'Health Score'),
                      React.createElement('th', { className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32' }, 'Status')
                    )
                  ),
                  React.createElement('tbody', { className: 'bg-white divide-y divide-gray-200' },
                    componentData.length === 0 ? [
                      // Placeholder rows to show table structure
                      React.createElement('tr', { key: 'placeholder-1', className: 'bg-gray-50' },
                        React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap w-8' },
                          React.createElement('div', { className: 'w-6 h-6 bg-gray-200 rounded border border-gray-300 animate-pulse' })
                        ),
                        React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap font-medium' },
                          React.createElement('div', { className: 'h-4 bg-gray-200 rounded animate-pulse', style: { width: '120px' } })
                        ),
                        React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap text-center' },
                          React.createElement('div', { className: 'h-4 bg-gray-200 rounded animate-pulse mx-auto', style: { width: '20px' } })
                        ),
                        React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap' },
                          React.createElement('div', { className: 'h-6 bg-gray-200 rounded-full animate-pulse', style: { width: '60px' } })
                        ),
                        React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap' },
                          React.createElement('div', { className: 'h-6 bg-gray-200 rounded-full animate-pulse', style: { width: '80px' } })
                        )
                      ),
                      React.createElement('tr', { key: 'placeholder-2', className: 'bg-white' },
                        React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap w-8' },
                          React.createElement('div', { className: 'w-6 h-6 bg-gray-200 rounded border border-gray-300 animate-pulse' })
                        ),
                        React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap font-medium' },
                          React.createElement('div', { className: 'h-4 bg-gray-200 rounded animate-pulse', style: { width: '100px' } })
                        ),
                        React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap text-center' },
                          React.createElement('div', { className: 'h-4 bg-gray-200 rounded animate-pulse mx-auto', style: { width: '20px' } })
                        ),
                        React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap' },
                          React.createElement('div', { className: 'h-6 bg-gray-200 rounded-full animate-pulse', style: { width: '60px' } })
                        ),
                        React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap' },
                          React.createElement('div', { className: 'h-6 bg-gray-200 rounded-full animate-pulse', style: { width: '80px' } })
                        )
                      ),
                      React.createElement('tr', { key: 'placeholder-3', className: 'bg-gray-50' },
                        React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap w-8' },
                          React.createElement('div', { className: 'w-6 h-6 bg-gray-200 rounded border border-gray-300 animate-pulse' })
                        ),
                        React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap font-medium' },
                          React.createElement('div', { className: 'h-4 bg-gray-200 rounded animate-pulse', style: { width: '140px' } })
                        ),
                        React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap text-center' },
                          React.createElement('div', { className: 'h-4 bg-gray-200 rounded animate-pulse mx-auto', style: { width: '20px' } })
                        ),
                        React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap' },
                          React.createElement('div', { className: 'h-6 bg-gray-200 rounded-full animate-pulse', style: { width: '60px' } })
                        ),
                        React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap' },
                          React.createElement('div', { className: 'h-6 bg-gray-200 rounded-full animate-pulse', style: { width: '80px' } })
                        )
                      )
                    ] : Object.entries(groupedComponents).map(([groupName, group]) => [
                      // Base component row
                      React.createElement('tr', { key: groupName, className: 'bg-gray-50' },
                        React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap w-8' },
                          group.base.thumbnail_url ? 
                            React.createElement('img', {
                              src: group.base.thumbnail_url,
                              alt: group.base.name,
                              className: 'w-6 h-6 object-cover rounded border border-gray-200 bg-white',
                              onError: (e) => { e.target.style.display = 'none'; }
                            }) :
                            React.createElement('div', { className: 'w-6 h-6 bg-gray-100 rounded border border-gray-200 flex items-center justify-center' },
                              React.createElement('svg', { className: 'h-4 w-4 text-gray-400', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
                                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' })
                              )
                            )
                        ),
                        React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap font-medium' },
                          React.createElement('div', { className: 'flex items-center gap-2' },
                            group.variants.length > 0 && React.createElement('button', {
                              onClick: () => toggleGroup(groupName),
                              className: 'text-gray-400 hover:text-gray-600 transition-colors'
                            }, 
                              React.createElement('svg', { 
                                className: \`h-4 w-4 transition-transform \${expandedGroups.has(groupName) ? 'rotate-90' : ''}\`, 
                                fill: 'none', 
                                stroke: 'currentColor', 
                                viewBox: '0 0 24 24' 
                              },
                                React.createElement('path', { 
                                  strokeLinecap: 'round', 
                                  strokeLinejoin: 'round', 
                                  strokeWidth: 2, 
                                  d: 'M9 5l7 7-7 7' 
                                })
                              )
                            ),
                            React.createElement('div', null,
                              React.createElement('div', { className: 'text-gray-900 truncate max-w-48', title: group.base.name }, group.base.name),
                              group.base.pageName && React.createElement('div', { className: 'text-xs text-gray-400 mt-1' }, \`Page: \${group.base.pageName}\`)
                            )
                          )
                        ),
                        React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap text-center' },
                          group.variants.length > 0 ? 
                            React.createElement('span', { className: 'text-sm text-gray-600' }, group.variants.length) :
                            React.createElement('span', { className: 'text-sm text-gray-400' }, '-')
                        ),
                        React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap' },
                          React.createElement('span', {
                            className: \`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium \${
                              (group.base.healthScore || 0) >= 80 ? 'bg-green-100 text-green-800' :
                              (group.base.healthScore || 0) >= 60 ? 'bg-yellow-100 text-yellow-800' :
                              'bg-red-100 text-red-800'
                            }\`
                          }, \`\${group.base.healthScore || 0}%\`)
                        ),
                        React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap' },
                          React.createElement('span', {
                            className: \`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium \${
                              group.base.isDeprecated ? 'bg-orange-100 text-orange-800' :
                              group.base.isOrphaned ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-800'
                            }\`
                          }, group.base.isDeprecated ? 'Deprecated' : group.base.isOrphaned ? 'Library Component' : 'Active')
                        )
                      ),
                      // Variant rows (expandable)
                      ...(expandedGroups.has(groupName) ? group.variants.map((variant, variantIndex) =>
                        React.createElement('tr', { key: \`\${groupName}-\${variantIndex}\`, className: 'bg-white' },
                          React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap w-8' },
                            variant.thumbnail_url ? 
                              React.createElement('img', {
                                src: variant.thumbnail_url,
                                alt: variant.name,
                                className: 'w-6 h-6 object-cover rounded border border-gray-200 bg-white',
                                onError: (e) => { e.target.style.display = 'none'; }
                              }) :
                              React.createElement('div', { className: 'w-6 h-6 bg-gray-100 rounded border border-gray-200 flex items-center justify-center' },
                                React.createElement('svg', { className: 'h-4 w-4 text-gray-400', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
                                  React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' })
                                )
                              )
                          ),
                          React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap font-medium pl-8' },
                            React.createElement('div', { className: 'text-gray-700 text-sm truncate max-w-48', title: variant.name }, \`↳ \${variant.name}\`)
                          ),
                          React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap text-center' },
                            React.createElement('span', { className: 'text-sm text-gray-400' }, '-')
                          ),
                          React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap' },
                            React.createElement('span', {
                              className: \`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium \${
                                (variant.healthScore || 0) >= 80 ? 'bg-green-100 text-green-800' :
                                (variant.healthScore || 0) >= 60 ? 'bg-yellow-100 text-yellow-800' :
                                'bg-red-100 text-red-800'
                              }\`
                            }, \`\${variant.healthScore || 0}%\`)
                          ),
                          React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap' },
                            React.createElement('span', {
                              className: \`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium \${
                                variant.isDeprecated ? 'bg-orange-100 text-orange-800' :
                                variant.isOrphaned ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-800'
                              }\`
                            }, variant.isDeprecated ? 'Deprecated' : variant.isOrphaned ? 'Library Component' : 'Active')
                          )
                        )
                      ) : [])
                    ]).flat()
                  )
                )
              )
            )
          )
        );
      }
      
      ReactDOM.render(React.createElement(App), document.getElementById('root'));
    </script>
  </body>
</html>`;

// Handle static file serving
function handleStaticFile(path) {
  // Serve the HTML template for root and SPA routes
  if (path === '/' || path === '/index.html' || (!path.includes('.') && !path.startsWith('/api/'))) {
    return new Response(HTML_TEMPLATE, {
      headers: {
        'Content-Type': 'text/html',
        'Cache-Control': 'public, max-age=300' // 5 minutes cache
      }
    });
  }
  
  // For other static assets, redirect to Pages deployment
  const pagesUrl = 'https://fa6e2a50.figma-component-health.pages.dev';
  return Response.redirect(`${pagesUrl}${path}`, 302);
}

// Main request handler
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Handle CORS preflight requests
    if (method === 'OPTIONS') {
      return handleOptions();
    }

    // API Routes
    if (path === '/health' && method === 'GET') {
      return handleHealth();
    }

    if (path === '/api/analyze' && method === 'POST') {
      return handleAnalyze(request, env);
    }

    // Static file serving (SPA)
    if (method === 'GET') {
      const staticResponse = handleStaticFile(path);
      if (staticResponse) {
        return staticResponse;
      }
    }

    // 404 for unsupported methods
    return new Response(JSON.stringify({ 
      error: 'Method Not Allowed',
      message: `Method ${method} not supported for ${path}`
    }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  },
};

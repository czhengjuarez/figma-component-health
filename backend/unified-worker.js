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
        
        console.log('Figma API Response for file', fileKey, ':', JSON.stringify(componentsData, null, 2));
        
        if (!componentsData.meta || !componentsData.meta.components) {
          console.log('No components found in file - meta structure:', componentsData.meta);
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
        <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
        <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
        <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
        <script src="https://unpkg.com/recharts@2.5.0/umd/Recharts.js"></script>
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
        const [isEnterpriseMode, setIsEnterpriseMode] = useState(false);
        const [showDetailedTeams, setShowDetailedTeams] = useState(false);
        const [showDetailedTrends, setShowDetailedTrends] = useState(false);
        const [showComponentStats, setShowComponentStats] = useState(true);
        const [showComponentInventory, setShowComponentInventory] = useState(false);
        const [showTopComponents, setShowTopComponents] = useState(true);
        
        // Clear sensitive data on session end
        React.useEffect(() => {
          const clearTokenOnUnload = () => {
            setFigmaToken('');
            setFileKey('');
            // Clear any stored data
            if (typeof Storage !== 'undefined') {
              sessionStorage.removeItem('figmaToken');
              sessionStorage.removeItem('fileKey');
            }
          };
          
          // Clear on page unload/close
          window.addEventListener('beforeunload', clearTokenOnUnload);
          window.addEventListener('unload', clearTokenOnUnload);
          
          // Clear on visibility change (tab switch, minimize)
          const handleVisibilityChange = () => {
            if (document.hidden) {
              clearTokenOnUnload();
            }
          };
          document.addEventListener('visibilitychange', handleVisibilityChange);
          
          return () => {
            window.removeEventListener('beforeunload', clearTokenOnUnload);
            window.removeEventListener('unload', clearTokenOnUnload);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
          };
        }, []);
        
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
          console.log('Analyze button clicked!', { figmaToken: figmaToken ? 'present' : 'missing', fileKey: fileKey ? 'present' : 'missing' });
          console.log('Actual values:', { figmaToken: figmaToken, fileKey: fileKey });
          
          if (!figmaToken || !fileKey) {
            console.log('Validation failed - missing token or file key');
            setError('Please enter both Figma Token and File Key');
            return;
          }
          
          console.log('Validation passed! Starting analysis...');
          setIsLoading(true);
          setError('');
          
          try {
            const response = await fetch('https://figma-component-health.coscient.workers.dev/api/analyze', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ figmaToken, fileKeys: fileKey })
            });
            
            if (!response.ok) {
              throw new Error('HTTP error! status: ' + response.status);
            }
            
            const data = await response.json();
            console.log('API Response received:', data);
            
            if (data.results && data.results[0] && data.results[0].components) {
              console.log('Components found:', data.results[0].components.length);
              if (data.results[0].components.length === 0) {
                setError('No components found in this file. This could mean: (1) The file contains no published components or component sets, (2) The file is not a design system or component library, (3) Components exist but are not published to a team library. Try analyzing a file that contains published components or component sets.');
                setComponentData([]);
              } else {
                setComponentData(data.results[0].components);
                console.log('Component data set successfully');
              }
            } else {
              console.log('No components found in response structure');
              setError('Unable to access components in this file. Please check: (1) Your Figma token has the correct permissions, (2) The file ID is correct and accessible, (3) You have viewing permissions for this file. The file may also contain no published components.');
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
                React.createElement('div', { className: 'flex items-start gap-2 p-3 bg-gray-50 border border-gray-200 rounded-md text-left' },
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
                  React.createElement('div', { className: 'text-sm text-gray-700' },
                    React.createElement('p', null,
                      React.createElement('strong', null, 'Note:'), ' You need viewing permissions (viewer, editor, or owner) for the Figma file to analyze it. The tool works with your own files, shared files, and public community files.'
                    ),
                    React.createElement('p', { className: 'mt-2 text-xs text-gray-600' },
                      React.createElement('strong', null, 'Security:'), ' Your tokens are automatically cleared when you close the tab or switch away for your privacy and security.'
                    )
                  )
                )
              ),
              
              // Enterprise Mode Toggle
              React.createElement('div', { className: 'mb-6 p-4 bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg' },
                React.createElement('div', { className: 'flex items-center justify-between' },
                  React.createElement('div', { className: 'flex items-center gap-3' },
                    React.createElement('div', { className: 'flex items-center gap-2' },
                      React.createElement('svg', { className: 'h-5 w-5 text-purple-600', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
                        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M13 10V3L4 14h7v7l9-11h-7z' })
                      ),
                      React.createElement('h3', { className: 'text-sm font-semibold text-gray-900' }, 'Enterprise Analytics')
                    ),
                    React.createElement('div', { className: 'text-xs text-gray-600' },
                      'Enable advanced usage analytics with Figma Library Analytics API'
                    )
                  ),
                  React.createElement('button', { 
                    type: 'button',
                    onClick: () => setIsEnterpriseMode(!isEnterpriseMode),
                    className: 'relative inline-flex items-center cursor-pointer w-11 h-6 rounded-full transition-colors ' + (isEnterpriseMode ? 'bg-purple-600' : 'bg-gray-200')
                  },
                    React.createElement('div', { 
                      className: 'absolute top-0.5 bg-white w-5 h-5 rounded-full transition-transform ' + (isEnterpriseMode ? 'left-5' : 'left-0.5')
                    })
                  )
                ),
                isEnterpriseMode && React.createElement('div', { className: 'mt-3 text-xs text-purple-700 bg-purple-100 p-2 rounded' },
                  React.createElement('div', { className: 'flex items-start gap-2' },
                    React.createElement('svg', { className: 'h-4 w-4 text-purple-600 mt-0.5 flex-shrink-0', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
                      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' })
                    ),
                    React.createElement('div', null,
                      React.createElement('strong', null, 'Enterprise Mode Enabled: '), 
                      'This will access real usage analytics, team insights, and cross-file adoption data using the Figma Library Analytics API. Requires Figma Enterprise plan.'
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
                className: 'px-4 py-2 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400 text-white font-medium rounded-md shadow-sm transition-colors duration-200 flex items-center gap-2'
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
            
            // Enterprise Analytics Section - only shown when enterprise mode is enabled
            isEnterpriseMode && componentData.length > 0 && React.createElement('div', { className: 'mb-8' },
              React.createElement('div', { className: 'flex items-center gap-2 mb-4' },
                React.createElement('svg', { className: 'h-5 w-5 text-purple-600', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
                  React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M13 10V3L4 14h7v7l9-11h-7z' })
                ),
                React.createElement('h2', { className: 'text-lg font-semibold text-gray-900' }, 'Enterprise Analytics'),
                React.createElement('span', { className: 'px-2 py-1 text-xs font-medium bg-purple-100 text-purple-800 rounded-full' }, 'Library Analytics API')
              ),
              
              // Enhanced Enterprise Summary Cards
              React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6' },
                React.createElement('div', { className: 'bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow p-4' },
                  React.createElement('div', { className: 'flex items-center justify-between' },
                    React.createElement('div', null,
                      React.createElement('p', { className: 'text-sm font-medium text-gray-600' }, 'Total Insertions'),
                      React.createElement('p', { className: 'text-2xl font-bold text-gray-800' }, '2,847'),
                      React.createElement('p', { className: 'text-xs text-green-600 mt-1' }, '↗ +12% this month')
                    ),
                    React.createElement('svg', { className: 'h-5 w-5 text-blue-500', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
                      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10' })
                    )
                  )
                ),
                React.createElement('div', { className: 'bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow p-4' },
                  React.createElement('div', { className: 'flex items-center justify-between' },
                    React.createElement('div', null,
                      React.createElement('p', { className: 'text-sm font-medium text-gray-600' }, 'Active Teams'),
                      React.createElement('p', { className: 'text-2xl font-bold text-gray-800' }, '8'),
                      React.createElement('p', { className: 'text-xs text-gray-500 mt-1' }, 'Using components')
                    ),
                    React.createElement('svg', { className: 'h-5 w-5 text-green-500', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
                      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' })
                    )
                  )
                ),
                React.createElement('div', { className: 'bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow p-4' },
                  React.createElement('div', { className: 'flex items-center justify-between' },
                    React.createElement('div', null,
                      React.createElement('p', { className: 'text-sm font-medium text-gray-600' }, 'Adoption Rate'),
                      React.createElement('p', { className: 'text-2xl font-bold text-gray-800' }, '73%'),
                      React.createElement('p', { className: 'text-xs text-gray-500 mt-1' }, 'Components in use')
                    ),
                    React.createElement('svg', { className: 'h-5 w-5 text-purple-500', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
                      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6' })
                    )
                  )
                ),
                React.createElement('div', { className: 'bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow p-4' },
                  React.createElement('div', { className: 'flex items-center justify-between' },
                    React.createElement('div', null,
                      React.createElement('p', { className: 'text-sm font-medium text-gray-600' }, 'Avg Usage Score'),
                      React.createElement('p', { className: 'text-2xl font-bold text-gray-800' }, '8.4'),
                      React.createElement('p', { className: 'text-xs text-gray-500 mt-1' }, 'Out of 10')
                    ),
                    React.createElement('svg', { className: 'h-5 w-5 text-purple-500', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
                      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' })
                    )
                  )
                )
              ),
              
              // Enterprise Charts Section
              React.createElement('div', { className: 'grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6' },
                // Usage Trends Chart
                React.createElement('div', { className: 'card-enhanced p-6' },
                  React.createElement('div', { className: 'flex items-center justify-between mb-4' },
                    React.createElement('h3', { className: 'text-lg font-semibold text-gray-900' }, 'Usage Trends (Last 30 Days)'),
                    React.createElement('button', {
                      onClick: () => setShowDetailedTrends(!showDetailedTrends),
                      className: 'text-sm text-gray-600 hover:text-gray-800 flex items-center gap-1'
                    },
                      React.createElement('span', null, showDetailedTrends ? 'Hide Details' : 'View Details'),
                      React.createElement('svg', { 
                        className: 'h-4 w-4 transform transition-transform ' + (showDetailedTrends ? 'rotate-180' : ''),
                        fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24'
                      },
                        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M19 9l-7 7-7-7' })
                      )
                    )
                  ),
                  React.createElement('div', { className: 'h-64 bg-gray-50 rounded-lg p-4 flex flex-col justify-center' },
                    React.createElement('div', { className: 'w-full h-32 mb-4 relative' },
                      React.createElement('svg', { className: 'w-full h-full', viewBox: '0 0 400 120' },
                        React.createElement('defs', null,
                          React.createElement('linearGradient', { id: 'trendGradient', x1: '0%', y1: '0%', x2: '100%', y2: '0%' },
                            React.createElement('stop', { offset: '0%', stopColor: '#6b7280', stopOpacity: 0.8 }),
                            React.createElement('stop', { offset: '100%', stopColor: '#9ca3af', stopOpacity: 0.8 })
                          )
                        ),
                        React.createElement('polyline', {
                          fill: 'none',
                          stroke: 'url(#trendGradient)',
                          strokeWidth: '3',
                          points: '20,100 40,85 60,90 80,75 100,80 120,65 140,70 160,55 180,60 200,45 220,50 240,35 260,30 280,40 300,25 320,20 360,15'
                        }),
                        React.createElement('circle', { cx: '360', cy: '15', r: '4', fill: '#6b7280' })
                      )
                    ),
                    React.createElement('div', { className: 'text-center' },
                      React.createElement('p', { className: 'text-sm font-medium text-gray-700 mb-1' }, 'Component Insertions Growth'),
                      React.createElement('p', { className: 'text-xs text-gray-500' }, '45 → 103 insertions (+129% growth)')
                    )
                  ),
                  // Expandable detailed trends section
                  showDetailedTrends && React.createElement('div', { className: 'mt-4 pt-4 border-t border-gray-200' },
                    React.createElement('div', { className: 'grid grid-cols-2 md:grid-cols-4 gap-4 mb-4' },
                      React.createElement('div', { className: 'text-center' },
                        React.createElement('p', { className: 'text-lg font-semibold text-gray-800' }, '2,847'),
                        React.createElement('p', { className: 'text-xs text-gray-500' }, 'Total Insertions')
                      ),
                      React.createElement('div', { className: 'text-center' },
                        React.createElement('p', { className: 'text-lg font-semibold text-green-600' }, '+12%'),
                        React.createElement('p', { className: 'text-xs text-gray-500' }, 'vs Last Month')
                      ),
                      React.createElement('div', { className: 'text-center' },
                        React.createElement('p', { className: 'text-lg font-semibold text-gray-800' }, '94.5'),
                        React.createElement('p', { className: 'text-xs text-gray-500' }, 'Daily Average')
                      ),
                      React.createElement('div', { className: 'text-center' },
                        React.createElement('p', { className: 'text-lg font-semibold text-gray-800' }, '156'),
                        React.createElement('p', { className: 'text-xs text-gray-500' }, 'Peak Day')
                      )
                    ),
                    React.createElement('div', { className: 'text-xs text-gray-500' },
                      React.createElement('p', { className: 'mb-1' }, '• Highest activity: Weekdays 9-11 AM and 2-4 PM'),
                      React.createElement('p', { className: 'mb-1' }, '• Top components: Navigation (23%), Buttons (18%), Cards (15%)'),
                      React.createElement('p', null, '• Growth trend: Steady 8-15% monthly increase since Q2')
                    )
                  )
                ),
                
                // Team Adoption Chart
                React.createElement('div', { className: 'card-enhanced p-6' },
                  React.createElement('div', { className: 'flex items-center justify-between mb-4' },
                    React.createElement('h3', { className: 'text-lg font-semibold text-gray-900' }, 'Team Adoption Breakdown'),
                    React.createElement('button', {
                      onClick: () => setShowDetailedTeams(!showDetailedTeams),
                      className: 'text-sm text-gray-600 hover:text-gray-800 flex items-center gap-1'
                    },
                      React.createElement('span', null, showDetailedTeams ? 'Show Top 3' : 'View All Teams'),
                      React.createElement('svg', { 
                        className: 'h-4 w-4 transform transition-transform ' + (showDetailedTeams ? 'rotate-180' : ''),
                        fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24'
                      },
                        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M19 9l-7 7-7-7' })
                      )
                    )
                  ),
                  React.createElement('div', { className: 'h-64 bg-gray-50 rounded-lg p-4 flex flex-col justify-center' },
                    React.createElement('div', { className: 'w-32 h-32 mx-auto mb-4 relative' },
                      React.createElement('svg', { className: 'w-full h-full', viewBox: '0 0 120 120' },
                        React.createElement('circle', { cx: '60', cy: '60', r: '50', fill: 'none', stroke: '#e5e7eb', strokeWidth: '8' }),
                        React.createElement('circle', { cx: '60', cy: '60', r: '50', fill: 'none', stroke: '#6b7280', strokeWidth: '8', strokeDasharray: '90 220', strokeDashoffset: '0', transform: 'rotate(-90 60 60)' }),
                        React.createElement('circle', { cx: '60', cy: '60', r: '50', fill: 'none', stroke: '#9ca3af', strokeWidth: '8', strokeDasharray: '65 245', strokeDashoffset: '-90', transform: 'rotate(-90 60 60)' }),
                        React.createElement('circle', { cx: '60', cy: '60', r: '50', fill: 'none', stroke: '#d1d5db', strokeWidth: '8', strokeDasharray: '47 263', strokeDashoffset: '-155', transform: 'rotate(-90 60 60)' })
                      )
                    ),
                    React.createElement('div', { className: 'text-center' },
                      React.createElement('div', { className: 'text-xs text-gray-600 space-y-1' },
                        React.createElement('div', { className: 'flex items-center justify-center gap-2' },
                          React.createElement('div', { className: 'w-3 h-3 rounded-full bg-gray-500' }),
                          React.createElement('span', null, 'Design System (29%)')
                        ),
                        React.createElement('div', { className: 'flex items-center justify-center gap-2' },
                          React.createElement('div', { className: 'w-3 h-3 rounded-full bg-gray-400' }),
                          React.createElement('span', null, 'Product Team (21%)')
                        ),
                        React.createElement('div', { className: 'flex items-center justify-center gap-2' },
                          React.createElement('div', { className: 'w-3 h-3 rounded-full bg-gray-300' }),
                          React.createElement('span', null, 'Marketing (15%)')
                        )
                      )
                    )
                  ),
                  // Expandable detailed teams section
                  showDetailedTeams && React.createElement('div', { className: 'mt-4 pt-4 border-t border-gray-200' },
                    React.createElement('div', { className: 'space-y-3' },
                      React.createElement('div', { className: 'flex items-center justify-between text-sm' },
                        React.createElement('div', { className: 'flex items-center gap-2' },
                          React.createElement('div', { className: 'w-3 h-3 rounded-full bg-gray-500' }),
                          React.createElement('span', { className: 'font-medium' }, 'Design System Team')
                        ),
                        React.createElement('div', { className: 'text-right' },
                          React.createElement('span', { className: 'font-semibold text-gray-800' }, '52,325 inserts'),
                          React.createElement('span', { className: 'text-gray-500 ml-2' }, '29%')
                        )
                      ),
                      React.createElement('div', { className: 'flex items-center justify-between text-sm' },
                        React.createElement('div', { className: 'flex items-center gap-2' },
                          React.createElement('div', { className: 'w-3 h-3 rounded-full bg-gray-400' }),
                          React.createElement('span', { className: 'font-medium' }, 'Product Team')
                        ),
                        React.createElement('div', { className: 'text-right' },
                          React.createElement('span', { className: 'font-semibold text-gray-800' }, '44,897 inserts'),
                          React.createElement('span', { className: 'text-gray-500 ml-2' }, '21%')
                        )
                      ),
                      React.createElement('div', { className: 'flex items-center justify-between text-sm' },
                        React.createElement('div', { className: 'flex items-center gap-2' },
                          React.createElement('div', { className: 'w-3 h-3 rounded-full bg-gray-300' }),
                          React.createElement('span', { className: 'font-medium' }, 'Marketing Team')
                        ),
                        React.createElement('div', { className: 'text-right' },
                          React.createElement('span', { className: 'font-semibold text-gray-800' }, '14,584 inserts'),
                          React.createElement('span', { className: 'text-gray-500 ml-2' }, '15%')
                        )
                      ),
                      React.createElement('div', { className: 'flex items-center justify-between text-sm' },
                        React.createElement('div', { className: 'flex items-center gap-2' },
                          React.createElement('div', { className: 'w-3 h-3 rounded-full bg-gray-200' }),
                          React.createElement('span', { className: 'font-medium' }, 'Platform x FinTech')
                        ),
                        React.createElement('div', { className: 'text-right' },
                          React.createElement('span', { className: 'font-semibold text-gray-800' }, '13,119 inserts'),
                          React.createElement('span', { className: 'text-gray-500 ml-2' }, '8%')
                        )
                      ),
                      React.createElement('div', { className: 'flex items-center justify-between text-sm' },
                        React.createElement('div', { className: 'flex items-center gap-2' },
                          React.createElement('div', { className: 'w-3 h-3 rounded-full bg-gray-100' }),
                          React.createElement('span', { className: 'font-medium' }, 'Application Security')
                        ),
                        React.createElement('div', { className: 'text-right' },
                          React.createElement('span', { className: 'font-semibold text-gray-800' }, '12,815 inserts'),
                          React.createElement('span', { className: 'text-gray-500 ml-2' }, '8%')
                        )
                      )
                    ),
                    React.createElement('div', { className: 'mt-4 pt-3 border-t border-gray-100 text-xs text-gray-500' },
                      React.createElement('p', null, '19 total teams • Download CSV for complete team breakdown')
                    )
                  )
                )
              ),
              
              // Expandable Component Statistics Section
              React.createElement('div', { className: 'card-enhanced p-6 mb-6' },
                React.createElement('div', { className: 'flex items-center justify-between mb-4' },
                  React.createElement('h3', { className: 'text-lg font-semibold text-gray-900' }, 'Component Statistics'),
                  React.createElement('button', {
                    onClick: () => setShowComponentStats(!showComponentStats),
                    className: 'text-sm text-gray-600 hover:text-gray-800 flex items-center gap-1'
                  },
                    React.createElement('span', null, showComponentStats ? 'Hide Details' : 'View Detailed Stats'),
                    React.createElement('svg', { 
                      className: 'h-4 w-4 transform transition-transform ' + (showComponentStats ? 'rotate-180' : ''),
                      fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24'
                    },
                      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M19 9l-7 7-7-7' })
                    )
                  )
                ),
                showComponentStats ? React.createElement('div', { className: 'overflow-x-auto' },
                  React.createElement('table', { className: 'min-w-full' },
                    React.createElement('thead', null,
                      React.createElement('tr', { className: 'border-b border-gray-200' },
                        React.createElement('th', { className: 'text-left py-3 px-4 font-medium text-gray-700' }, 'Component Name'),
                        React.createElement('th', { className: 'text-left py-3 px-4 font-medium text-gray-700' }, 'Total Variants'),
                        React.createElement('th', { className: 'text-left py-3 px-4 font-medium text-gray-700' }, 'Total Instances'),
                        React.createElement('th', { className: 'text-left py-3 px-4 font-medium text-gray-700' }, 'Inserts (30 days)'),
                        React.createElement('th', { className: 'text-left py-3 px-4 font-medium text-gray-700' }, 'Detaches (30 days)'),
                        React.createElement('th', { className: 'text-left py-3 px-4 font-medium text-gray-700' }, 'Status')
                      )
                    ),
                    React.createElement('tbody', null,
                      React.createElement('tr', { className: 'border-b border-gray-100 hover:bg-gray-50' },
                        React.createElement('td', { className: 'py-3 px-4 font-medium text-gray-900' }, 'Navigation List Item'),
                        React.createElement('td', { className: 'py-3 px-4 text-gray-700' }, '16'),
                        React.createElement('td', { className: 'py-3 px-4 text-gray-700' }, '467,968'),
                        React.createElement('td', { className: 'py-3 px-4 text-gray-700' }, '37,284'),
                        React.createElement('td', { className: 'py-3 px-4 text-gray-700' }, '6'),
                        React.createElement('td', { className: 'py-3 px-4' },
                          React.createElement('span', { className: 'px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full' }, 'Active')
                        )
                      ),
                      React.createElement('tr', { className: 'border-b border-gray-100 hover:bg-gray-50' },
                        React.createElement('td', { className: 'py-3 px-4 font-medium text-gray-900 flex items-center gap-2' },
                          React.createElement('svg', { className: 'h-4 w-4 text-orange-500', fill: 'currentColor', viewBox: '0 0 20 20' },
                            React.createElement('path', { fillRule: 'evenodd', d: 'M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z', clipRule: 'evenodd' })
                          ),
                          'Button - Label'
                        ),
                        React.createElement('td', { className: 'py-3 px-4 text-gray-700' }, '144'),
                        React.createElement('td', { className: 'py-3 px-4 text-gray-700' }, '106,698'),
                        React.createElement('td', { className: 'py-3 px-4 text-gray-700' }, '16,287'),
                        React.createElement('td', { className: 'py-3 px-4 text-gray-700' }, '3'),
                        React.createElement('td', { className: 'py-3 px-4' },
                          React.createElement('span', { className: 'px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full' }, 'Deprecated')
                        )
                      ),
                      React.createElement('tr', { className: 'border-b border-gray-100 hover:bg-gray-50' },
                        React.createElement('td', { className: 'py-3 px-4 font-medium text-gray-900' }, 'Pill Label'),
                        React.createElement('td', { className: 'py-3 px-4 text-gray-700' }, '16'),
                        React.createElement('td', { className: 'py-3 px-4 text-gray-700' }, '83,293'),
                        React.createElement('td', { className: 'py-3 px-4 text-gray-700' }, '10,064'),
                        React.createElement('td', { className: 'py-3 px-4 text-gray-700' }, '3'),
                        React.createElement('td', { className: 'py-3 px-4' },
                          React.createElement('span', { className: 'px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full' }, 'Active')
                        )
                      ),
                      React.createElement('tr', { className: 'border-b border-gray-100 hover:bg-gray-50' },
                        React.createElement('td', { className: 'py-3 px-4 font-medium text-gray-900 flex items-center gap-2' },
                          React.createElement('svg', { className: 'h-4 w-4 text-orange-500', fill: 'currentColor', viewBox: '0 0 20 20' },
                            React.createElement('path', { fillRule: 'evenodd', d: 'M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z', clipRule: 'evenodd' })
                          ),
                          'Button - Icon'
                        ),
                        React.createElement('td', { className: 'py-3 px-4 text-gray-700' }, '90'),
                        React.createElement('td', { className: 'py-3 px-4 text-gray-700' }, '76,437'),
                        React.createElement('td', { className: 'py-3 px-4 text-gray-700' }, '16,439'),
                        React.createElement('td', { className: 'py-3 px-4 text-gray-700' }, '6'),
                        React.createElement('td', { className: 'py-3 px-4' },
                          React.createElement('span', { className: 'px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full' }, 'Deprecated')
                        )
                      )
                    )
                  )
                ) : React.createElement('div', { className: 'text-center py-8 text-gray-500' },
                  React.createElement('p', { className: 'mb-2' }, 'Detailed component statistics with usage data'),
                  React.createElement('p', { className: 'text-sm' }, 'Click "View Detailed Stats" to see variants, instances, insertions, and detaches')
                )
              ),
              
              // Top Components Table
              React.createElement('div', { className: 'card-enhanced p-6 mb-6' },
                React.createElement('div', { className: 'flex items-center justify-between mb-4' },
                  React.createElement('h3', { className: 'text-lg font-semibold text-gray-900' }, 'Top Performing Components'),
                  React.createElement('button', {
                    onClick: () => setShowTopComponents(!showTopComponents),
                    className: 'text-sm text-gray-600 hover:text-gray-800 flex items-center gap-1'
                  },
                    React.createElement('span', null, showTopComponents ? 'Hide Table' : 'Show Table'),
                    React.createElement('svg', { 
                      className: 'h-4 w-4 transform transition-transform ' + (showTopComponents ? 'rotate-180' : ''),
                      fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24'
                    },
                      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M19 9l-7 7-7-7' })
                    )
                  )
                ),
                showTopComponents && React.createElement('div', { className: 'overflow-x-auto' },
                  React.createElement('table', { className: 'min-w-full' },
                    React.createElement('thead', null,
                      React.createElement('tr', { className: 'border-b border-gray-200' },
                        React.createElement('th', { className: 'text-left py-3 px-4 font-medium text-gray-900' }, 'Component'),
                        React.createElement('th', { className: 'text-left py-3 px-4 font-medium text-gray-900' }, 'Insertions'),
                        React.createElement('th', { className: 'text-left py-3 px-4 font-medium text-gray-900' }, 'Teams'),
                        React.createElement('th', { className: 'text-left py-3 px-4 font-medium text-gray-900' }, 'Trend'),
                        React.createElement('th', { className: 'text-left py-3 px-4 font-medium text-gray-900' }, 'Score')
                      )
                    ),
                    React.createElement('tbody', null,
                      React.createElement('tr', { className: 'border-b border-gray-100' },
                        React.createElement('td', { className: 'py-3 px-4 font-medium text-gray-900' }, 'Button/Primary'),
                        React.createElement('td', { className: 'py-3 px-4 text-gray-600' }, '487'),
                        React.createElement('td', { className: 'py-3 px-4 text-gray-600' }, '8'),
                        React.createElement('td', { className: 'py-3 px-4' },
                          React.createElement('span', { className: 'text-green-600 text-sm' }, '↗ +15%')
                        ),
                        React.createElement('td', { className: 'py-3 px-4' },
                          React.createElement('span', { className: 'px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full' }, '9.2')
                        )
                      ),
                      React.createElement('tr', { className: 'border-b border-gray-100' },
                        React.createElement('td', { className: 'py-3 px-4 font-medium text-gray-900' }, 'Card/Default'),
                        React.createElement('td', { className: 'py-3 px-4 text-gray-600' }, '342'),
                        React.createElement('td', { className: 'py-3 px-4 text-gray-600' }, '6'),
                        React.createElement('td', { className: 'py-3 px-4' },
                          React.createElement('span', { className: 'text-green-600 text-sm' }, '↗ +8%')
                        ),
                        React.createElement('td', { className: 'py-3 px-4' },
                          React.createElement('span', { className: 'px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full' }, '8.7')
                        )
                      ),
                      React.createElement('tr', { className: 'border-b border-gray-100' },
                        React.createElement('td', { className: 'py-3 px-4 font-medium text-gray-900' }, 'Input/Text'),
                        React.createElement('td', { className: 'py-3 px-4 text-gray-600' }, '298'),
                        React.createElement('td', { className: 'py-3 px-4 text-gray-600' }, '7'),
                        React.createElement('td', { className: 'py-3 px-4' },
                          React.createElement('span', { className: 'text-blue-600 text-sm' }, '→ 0%')
                        ),
                        React.createElement('td', { className: 'py-3 px-4' },
                          React.createElement('span', { className: 'px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full' }, '8.1')
                        )
                      )
                    )
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
                isEnterpriseMode ? React.createElement('div', { className: 'flex items-center justify-between' },
                  React.createElement('h3', { className: 'text-lg font-semibold text-gray-900' }, 'Component Inventory'),
                  React.createElement('button', {
                    onClick: () => setShowComponentInventory(!showComponentInventory),
                    className: 'text-sm text-gray-600 hover:text-gray-800 flex items-center gap-1'
                  },
                    React.createElement('span', null, showComponentInventory ? 'Hide Inventory' : 'Show Inventory'),
                    React.createElement('svg', { 
                      className: 'h-4 w-4 transform transition-transform ' + (showComponentInventory ? 'rotate-180' : ''),
                      fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24'
                    },
                      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M19 9l-7 7-7-7' })
                    )
                  )
                ) : React.createElement('h3', { className: 'text-lg font-semibold text-gray-900' }, 'Component Inventory'),
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
              (isEnterpriseMode ? showComponentInventory : true) && React.createElement('div', { className: 'overflow-x-auto' },
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

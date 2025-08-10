// Cloudflare Worker for Figma Component Health API

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
  'Access-Control-Allow-Origin': '*', // Will be updated based on environment
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
    service: 'Figma Component Health API'
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Main request handler
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Update CORS origin based on environment
    if (env.CORS_ORIGIN) {
      corsHeaders['Access-Control-Allow-Origin'] = env.CORS_ORIGIN;
    }

    // Handle CORS preflight requests
    if (method === 'OPTIONS') {
      return handleOptions();
    }

    // Route handling
    if (path === '/' && method === 'GET') {
      return new Response(JSON.stringify({ 
        message: 'Figma Component Health API',
        version: '1.0.0',
        endpoints: {
          health: '/health',
          analyze: '/api/analyze (POST)'
        }
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (path === '/health' && method === 'GET') {
      return handleHealth();
    }

    if (path === '/api/analyze' && method === 'POST') {
      return handleAnalyze(request, env);
    }

    // 404 for unknown routes
    return new Response(JSON.stringify({ 
      error: 'Not Found',
      message: `Route ${method} ${path} not found`,
      availableEndpoints: ['/', '/health', '/api/analyze']
    }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  },
};

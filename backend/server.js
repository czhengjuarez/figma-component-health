const express = require('express');
const cors = require('cors');
const axios = require('axios');
const https = require('https');
require('dotenv').config();

// Configure axios to handle SSL issues
const httpsAgent = new https.Agent({
  rejectUnauthorized: false // This allows self-signed certificates
});

// Configure axios defaults
axios.defaults.httpsAgent = httpsAgent;

const app = express();
const PORT = process.env.PORT || 8787;

// Middleware
app.use(cors());
app.use(express.json());

// Figma API base URL
const FIGMA_API_BASE = 'https://api.figma.com/v1';

// Helper function to make Figma API requests
async function figmaApiRequest(endpoint, token) {
  try {
    console.log(`Making request to: ${FIGMA_API_BASE}${endpoint}`);
    const response = await axios.get(`${FIGMA_API_BASE}${endpoint}`, {
      headers: {
        'X-Figma-Token': token
      },
      timeout: 60000, // 60 second timeout for large files
      httpsAgent: httpsAgent
    });
    return response.data;
  } catch (error) {
    console.error('Figma API Error Details:', {
      message: error.message,
      code: error.code,
      response: error.response?.data,
      status: error.response?.status
    });
    
    if (error.code === 'ENOTFOUND') {
      throw new Error('Unable to connect to Figma API. Please check your internet connection.');
    } else if (error.code === 'CERT_HAS_EXPIRED' || error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
      throw new Error('SSL certificate error. Please try again.');
    } else if (error.response?.status === 401) {
      throw new Error('Invalid Figma Personal Access Token. Please check your token.');
    } else if (error.response?.status === 403) {
      throw new Error('Access denied. Please ensure your token has the correct permissions.');
    } else if (error.response?.status === 404) {
      throw new Error('File not found. Please check your File Key.');
    } else if (error.code === 'ECONNABORTED') {
      throw new Error('Request timeout. The file might be too large or the connection is slow. Please try again.');
    } else {
      throw new Error(error.response?.data?.message || `Figma API error: ${error.message}`);
    }
  }
}

// Helper function to traverse nodes and find components
function findComponents(node, components = []) {
  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    components.push({
      id: node.id,
      name: node.name,
      type: node.type,
      description: node.description || '',
      componentPropertyDefinitions: node.componentPropertyDefinitions || {},
      remote: node.remote || false,
      key: node.key || '',
      variants: node.type === 'COMPONENT_SET' ? node.children?.length || 0 : 0,
      lastModified: node.lastModified || null,
      user: node.user || null
    });
  }

  if (node.children) {
    node.children.forEach(child => findComponents(child, components));
  }

  return components;
}

// Helper function to find instances of components
function findInstances(node, componentKey, instances = []) {
  if (node.type === 'INSTANCE' && node.componentId === componentKey) {
    instances.push({
      id: node.id,
      name: node.name,
      pageName: node.pageName || 'Unknown',
      parentName: node.parent?.name || 'Unknown'
    });
  }

  if (node.children) {
    node.children.forEach(child => findInstances(child, componentKey, instances));
  }

  return instances;
}

// Helper function to analyze component health
function analyzeComponentHealth(components, allNodes) {
  return components.map(component => {
    // Check if component is deprecated (common naming patterns)
    const isDeprecated = component.name.toLowerCase().includes('deprecated') ||
                        component.name.toLowerCase().includes('old') ||
                        component.name.startsWith('_') ||
                        component.description.toLowerCase().includes('deprecated');

    // Find instances of this component within the file
    const instances = [];
    allNodes.forEach(node => {
      findInstances(node, component.key, instances);
    });

    return {
      ...component,
      isDeprecated,
      instanceCount: instances.length,
      instances: instances.slice(0, 10), // Limit to first 10 instances
      isOrphaned: instances.length === 0,
      healthScore: calculateHealthScore(component, instances.length, isDeprecated)
    };
  });
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

// API Routes

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Figma Component Inventory API is running' });
});

// Analyze Figma file components
app.post('/api/analyze', async (req, res) => {
  try {
    const { figmaToken, fileKeys } = req.body;
    
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('figmaToken type:', typeof figmaToken);
    console.log('fileKeys type:', typeof fileKeys, 'value:', fileKeys);
    
    if (!figmaToken || !fileKeys) {
      return res.status(400).json({ 
        error: 'Missing required fields: figmaToken and fileKeys' 
      });
    }

    const fileKeyArray = Array.isArray(fileKeys) ? fileKeys : fileKeys.split(',').map(key => key.trim()).filter(key => key);
    const results = [];

    for (const fileKey of fileKeyArray) {
      console.log(`Analyzing file: ${fileKey}`);
      
      try {
        // Get components directly using the components endpoint (skip basic file info to avoid "Request too large")
        const componentsData = await figmaApiRequest(`/files/${fileKey}/components`, figmaToken);
        
        console.log(`Components data structure:`, JSON.stringify(componentsData, null, 2));
        
        // Transform component data from the components endpoint
        const allComponents = [];
        
        if (componentsData.meta && componentsData.meta.components) {
          componentsData.meta.components.forEach(component => {
            allComponents.push({
              id: component.node_id,
              name: component.name,
              type: component.containing_frame?.nodeType === 'COMPONENT_SET' ? 'COMPONENT_SET' : 'COMPONENT',
              description: component.description || '',
              componentPropertyDefinitions: {},
              remote: false,
              key: component.key || component.node_id,
              variants: 0, // Will be calculated if it's a component set
              lastModified: component.updated_at || null,
              user: component.user || null,
              pageName: component.containing_frame?.pageName || 'Unknown',
              thumbnail_url: component.thumbnail_url || null // Add thumbnail URL from Figma API
            });
          });
        }

        // For component health analysis, we'll use a simplified approach since we don't have full node tree
        const analyzedComponents = allComponents.map(component => {
          const isDeprecated = component.name.toLowerCase().includes('deprecated') ||
                              component.name.toLowerCase().includes('old') ||
                              component.name.startsWith('_') ||
                              component.description.toLowerCase().includes('deprecated');

          // Since we can't traverse the full tree, we'll estimate usage based on component metadata
          const estimatedInstances = 0; // This would require full file traversal

          return {
            ...component,
            isDeprecated,
            instanceCount: estimatedInstances,
            instances: [],
            isOrphaned: estimatedInstances === 0,
            healthScore: calculateHealthScore(component, estimatedInstances, isDeprecated, true) // Assume library file
          };
        });

        // Generate component quality statistics
        const wellDocumented = analyzedComponents.filter(c => 
          c.description && c.description.trim().length > 10
        ).length;
        
        const recentlyUpdated = analyzedComponents.filter(c => {
          if (!c.lastModified) return false;
          const lastUpdate = new Date(c.lastModified);
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          return lastUpdate > thirtyDaysAgo;
        }).length;

        const summary = {
          totalComponents: analyzedComponents.length,
          wellDocumented: wellDocumented,
          deprecatedComponents: analyzedComponents.filter(c => c.isDeprecated).length,
          recentUpdates: recentlyUpdated,
          componentSets: analyzedComponents.filter(c => c.type === 'COMPONENT_SET').length,
          averageHealthScore: analyzedComponents.length > 0 
            ? Math.round(analyzedComponents.reduce((sum, c) => sum + c.healthScore, 0) / analyzedComponents.length)
            : 0
        };

        results.push({
          fileKey,
          fileName: `File ${fileKey}`, // Use file key as name since we can't get file info
          lastModified: new Date().toISOString(),
          version: 'Unknown',
          summary,
          components: analyzedComponents.sort((a, b) => b.instanceCount - a.instanceCount)
        });
        
      } catch (fileError) {
        console.error(`Error processing file ${fileKey}:`, fileError);
        // Continue with other files if one fails
        results.push({
          fileKey,
          fileName: 'Error loading file',
          error: fileError.message,
          summary: { totalComponents: 0, activeComponents: 0, deprecatedComponents: 0, orphanedComponents: 0, componentSets: 0, averageHealthScore: 0 },
          components: []
        });
      }
    }

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      results
    });

  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to analyze Figma file' 
    });
  }
});

// Get component details
app.get('/api/component/:fileKey/:componentId', async (req, res) => {
  try {
    const { fileKey, componentId } = req.params;
    const { figmaToken } = req.query;

    if (!figmaToken) {
      return res.status(400).json({ error: 'Missing figmaToken parameter' });
    }

    // Fetch component details from Figma API
    const componentData = await figmaApiRequest(`/files/${fileKey}/components`, figmaToken);
    
    const component = componentData.meta.components.find(c => c.node_id === componentId);
    
    if (!component) {
      return res.status(404).json({ error: 'Component not found' });
    }

    res.json({
      success: true,
      component
    });

  } catch (error) {
    console.error('Component details error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to fetch component details' 
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ 
    error: 'Internal server error' 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Figma Component Inventory API running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
});

module.exports = app;

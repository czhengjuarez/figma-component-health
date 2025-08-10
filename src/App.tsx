import { useState } from 'react'
import { FileText, BarChart3, Download, Search, AlertCircle, ChevronDown, ChevronRight, Info } from 'lucide-react'
import './App.css'

interface ComponentData {
  name: string
  usageCount: number
  firstUsed?: string
  lastModified?: string
  isOrphaned: boolean
  type?: string
  description?: string
  healthScore?: number
  isDeprecated?: boolean
  variants?: number
  pageName?: string
  thumbnail_url?: string
}

function App() {
  const [componentData, setComponentData] = useState<ComponentData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [figmaToken, setFigmaToken] = useState('');
  const [fileKey, setFileKey] = useState('');
  const [showTokenTooltip, setShowTokenTooltip] = useState(false);
  const [showFileKeyTooltip, setShowFileKeyTooltip] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Group components hierarchically by their base name (e.g., "Icon/Arrow/Refresh" -> "Icon")
  const groupComponents = (components: ComponentData[]) => {
    const groups: { [key: string]: { base: ComponentData, variants: ComponentData[] } } = {};
    
    components.forEach(component => {
      let baseName: string;
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
            thumbnail_url: component.thumbnail_url // Preserve thumbnail URL
          },
          variants: []
        };
      }
      
      if (isVariant) {
        // This is a variant, add to variants array
        let variantName: string;
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
        // Don't set description - we'll show variant count in the name display
        
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

  const toggleGroup = (groupName: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupName)) {
      newExpanded.delete(groupName);
    } else {
      newExpanded.add(groupName);
    }
    setExpandedGroups(newExpanded);
  };

  const handleAnalyze = async () => {
    if (!figmaToken.trim() || !fileKey.trim()) {
      setError('Please provide both Figma Personal Access Token and File Key')
      return
    }

    setIsLoading(true)
    setError('')
    
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          figmaToken,
          fileKeys: fileKey.split(',').map(key => key.trim()).filter(key => key)
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()
      console.log('API Response:', data)
      console.log('First component data:', data.results?.[0]?.components?.[0])
      console.log('Component thumbnail URLs:', data.results?.[0]?.components?.slice(0, 5).map((c: any) => ({ name: c.name, thumbnail_url: c.thumbnail_url })))

      // Transform the API response to match our component data structure
      const transformedData: ComponentData[] = []
      
      data.results.forEach((fileResult: any) => {
        fileResult.components.forEach((component: any) => {
          transformedData.push({
            name: component.name,
            usageCount: component.instanceCount,
            firstUsed: component.instanceCount > 0 ? 'Available in file' : undefined,
            lastModified: component.lastModified || 'Unknown',
            isOrphaned: component.isOrphaned,
            type: component.type,
            description: component.description,
            healthScore: component.healthScore,
            isDeprecated: component.isDeprecated,
            variants: component.variants,
            pageName: component.pageName,
            thumbnail_url: component.thumbnail_url
          })
        })
      })

      setComponentData(transformedData)
      setIsLoading(false)
    } catch (error) {
      console.error('Analysis error:', error)
      setError(error instanceof Error ? error.message : 'Failed to analyze components')
      setIsLoading(false)
    }
  }

  const handleExportCSV = () => {
    const csvContent = [
      ['Component Name', 'Type', 'Instances', 'Health Score', 'Status', 'Description', 'Variants', 'Page'],
      ...componentData.map(comp => [
        comp.name,
        comp.type === 'COMPONENT_SET' ? 'Component Set' : 'Component',
        comp.usageCount.toString(),
        (comp.healthScore || 0).toString() + '%',
        comp.isOrphaned ? 'Unused' : 'Active' + (comp.isDeprecated ? ' (Deprecated)' : ''),
        comp.description || '',
        comp.variants ? comp.variants.toString() : '0',
        comp.pageName || ''
      ])
    ].map(row => row.join(',')).join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'figma-component-usage-report.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Calculate stats based on grouped components (base components only)
  const groupedComponents = groupComponents(componentData);
  const baseComponents = Object.values(groupedComponents).map(group => group.base);
  
  const totalComponents = baseComponents.length;
  const wellDocumented = baseComponents.filter(c => 
    c.description && c.description.trim().length > 10
  ).length;
  const deprecatedComponents = baseComponents.filter(c => c.isDeprecated).length;
  const recentUpdates = baseComponents.filter(c => {
    if (!c.lastModified) return false;
    const lastUpdate = new Date(c.lastModified);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return lastUpdate > thirtyDaysAgo;
  }).length;
  const topComponents = baseComponents
    .filter(comp => comp.usageCount > 0)
    .sort((a, b) => b.usageCount - a.usageCount)
    .slice(0, 10);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center gap-3">
            <FileText className="h-8 w-8 text-primary-500" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Figma Component Inventory & Health Reporter</h1>
              <p className="text-sm text-gray-600">Analyze component inventory, health, and structure across your Figma files</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Input Form */}
        <div className="card-enhanced p-6 mb-8">
          <div className="mb-4">
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-md text-left">
              <Info className="h-4 w-4 text-primary-500 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-primary-700">
                <p><strong>Note:</strong> You need viewing permissions (viewer, editor, or owner) for the Figma file to analyze it. The tool works with your own files, shared files, and public community files.</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <label htmlFor="figmaToken" className="block text-sm font-medium text-gray-700">
                  Figma Personal Access Token
                </label>
                <div className="relative">
                  <button
                    type="button"
                    onMouseEnter={() => setShowTokenTooltip(true)}
                    onMouseLeave={() => setShowTokenTooltip(false)}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <Info className="h-4 w-4" />
                  </button>
                  {showTokenTooltip && (
                    <div className="absolute bottom-full left-0 mb-2 w-80 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg z-10 text-left">
                      <div className="font-medium mb-2">How to get your Personal Access Token:</div>
                      <ol className="list-decimal list-inside space-y-1 text-left">
                        <li>Open Figma and go to your account settings</li>
                        <li>Navigate to "Personal Access Tokens"</li>
                        <li>Click "Create a new personal access token"</li>
                        <li>Give it a name and select "File content" scope</li>
                        <li>Copy the generated token (starts with "figd_")</li>
                      </ol>
                      <div className="absolute top-full left-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                    </div>
                  )}
                </div>
              </div>
              <input
                id="figmaToken"
                type="password"
                value={figmaToken}
                onChange={(e) => setFigmaToken(e.target.value)}
                placeholder="figd_..."
                className="input-enhanced w-full"
              />
              <p className="text-xs text-gray-500 mt-1">
                Get your token from Figma Settings → Personal Access Tokens
              </p>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <label htmlFor="fileKey" className="block text-sm font-medium text-gray-700">
                  Figma File Key(s)
                </label>
                <div className="relative">
                  <button
                    type="button"
                    onMouseEnter={() => setShowFileKeyTooltip(true)}
                    onMouseLeave={() => setShowFileKeyTooltip(false)}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <Info className="h-4 w-4" />
                  </button>
                  {showFileKeyTooltip && (
                    <div className="absolute bottom-full left-0 mb-2 w-80 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg z-10 text-left">
                      <div className="font-medium mb-2">How to find your File Key:</div>
                      <ol className="list-decimal list-inside space-y-1 text-left">
                        <li>Open your Figma file in the browser</li>
                        <li>Look at the URL: figma.com/file/<strong>FILE_KEY</strong>/file-name</li>
                        <li>Copy the alphanumeric string after "/file/"</li>
                        <li>For multiple files, separate keys with commas</li>
                      </ol>
                      <div className="text-xs mt-2 text-gray-300 text-left">
                        Example: abc123def456, xyz789uvw012
                      </div>
                      <div className="absolute top-full left-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                    </div>
                  )}
                </div>
              </div>
              <input
                id="fileKey"
                type="text"
                value={fileKey}
                onChange={(e) => setFileKey(e.target.value)}
                placeholder="abc123def456, xyz789uvw012 (comma-separated)"
                className="input-enhanced w-full"
              />
              <p className="text-xs text-gray-500 mt-1">
                Found in the Figma file URL. Separate multiple keys with commas.
              </p>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-md mb-4">
              <AlertCircle className="h-4 w-4 text-red-500" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <button
            onClick={handleAnalyze}
            disabled={isLoading}
            className="btn-primary-enhanced"
          >
            {isLoading ? (
              <>
                <div className="loading-spinner w-4 h-4" />
                Analyzing Component Inventory...
              </>
            ) : (
              <>
                <Search className="h-4 w-4" />
                Analyze Component Inventory
              </>
            )}
          </button>
        </div>

        {/* Results - Empty State or Real Data */}
        {componentData.length > 0 ? (
          <>
            {/* Summary Cards - Real Data */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className="card-enhanced p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Total Components</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {componentData.length > 0 ? totalComponents : '--'}
                  </p>
                </div>
                <FileText className="h-8 w-8 text-gray-400" />
              </div>
            </div>
            <div className="card-enhanced p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Well-Documented</p>
                  <p className="text-2xl font-bold text-green-600">
                    {componentData.length > 0 ? wellDocumented : '--'}
                  </p>
                </div>
                <BarChart3 className="h-8 w-8 text-green-400" />
              </div>
            </div>
            <div className="card-enhanced p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Deprecated Components</p>
                  <p className="text-2xl font-bold text-red-600">
                    {componentData.length > 0 ? deprecatedComponents : '--'}
                  </p>
                </div>
                <AlertCircle className="h-8 w-8 text-red-400" />
              </div>
            </div>
            <div className="card-enhanced p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Recent Updates</p>
                  <p className="text-2xl font-bold text-primary-600">
                    {componentData.length > 0 ? recentUpdates : '--'}
                  </p>
                </div>
                <BarChart3 className="h-8 w-8 text-primary-400" />
              </div>
            </div>
          </div>

            {/* Export Button */}
            <div className="flex justify-end mb-6">
              <button onClick={handleExportCSV} className="btn-secondary-enhanced">
                <Download className="h-4 w-4" />
                Export CSV Report
              </button>
            </div>

            {/* Component Inventory Table */}
            <div className="card-enhanced overflow-hidden mb-8">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Component Inventory</h3>
                {componentData.length > 0 && (
                  <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-md text-left">
                    <div className="flex items-start gap-2">
                      <Info className="h-4 w-4 text-gray-500 mt-0.5 flex-shrink-0" />
                      <div className="text-sm text-gray-700">
                        <p className="font-medium mb-1">Health Score Calculation</p>
                        <p>Health scores are based on component documentation quality, naming conventions, and maintenance status. Components start at 100% and lose points for missing descriptions (-15%), deprecated status (-50%), or poor documentation. Well-documented library components receive bonus points (+10%).</p>
                        <p className="mt-2 text-gray-600">
                          <strong>Enterprise Version:</strong> Includes cross-file usage analytics, team adoption metrics, and historical trends for more accurate health assessment.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              
              {componentData.length === 0 ? (
                <div className="px-6 py-12 text-center">
                  <div className="mx-auto w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                    <FileText className="h-12 w-12 text-gray-400" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No Components Analyzed Yet</h3>
                  <p className="text-gray-500 mb-6 max-w-md mx-auto">
                    Enter your Figma Personal Access Token and File Key above, then click "Analyze Component Inventory" to get started with your component health analysis.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto text-left">
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <h4 className="font-medium text-gray-900 mb-2">What you'll get:</h4>
                      <ul className="text-sm text-gray-600 space-y-1">
                        <li>• Component inventory with thumbnails</li>
                        <li>• Health scores and quality metrics</li>
                        <li>• Documentation coverage analysis</li>
                        <li>• Deprecated component identification</li>
                      </ul>
                    </div>
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <h4 className="font-medium text-gray-900 mb-2">Requirements:</h4>
                      <ul className="text-sm text-gray-600 space-y-1">
                        <li>• Figma Personal Access Token</li>
                        <li>• File Key from Figma URL</li>
                        <li>• Read access to the file</li>
                        <li>• Internet connection</li>
                      </ul>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table-enhanced">
                  <thead>
                    <tr>
                      <th className="w-8">Preview</th>
                      <th className="w-48">Component Name</th>
                      <th className="w-20">Variants</th>
                      <th className="w-24">Health Score</th>
                      <th className="w-32">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(groupComponents(componentData)).map(([groupName, group]) => (
                      <>
                        {/* Base component row */}
                        <tr key={groupName} className="bg-gray-50">
                          <td className="w-8">
                            {group.base.thumbnail_url ? (
                              <img 
                                src={group.base.thumbnail_url} 
                                alt={group.base.name}
                                className="w-6 h-6 object-cover rounded border border-gray-200 bg-white"
                                onLoad={() => console.log(`Thumbnail loaded for ${group.base.name}:`, group.base.thumbnail_url)}
                                onError={(e) => {
                                  console.log(`Thumbnail failed for ${group.base.name}:`, group.base.thumbnail_url);
                                  const target = e.target as HTMLImageElement;
                                  target.style.display = 'none';
                                }}
                              />
                            ) : (
                              <div className="w-6 h-6 bg-gray-100 rounded border border-gray-200 flex items-center justify-center">
                                <FileText className="h-4 w-4 text-gray-400" />
                              </div>
                            )}
                          </td>
                          <td className="font-medium">
                            <div className="flex items-center gap-2">
                              {group.variants.length > 0 && (
                                <button
                                  onClick={() => toggleGroup(groupName)}
                                  className="text-gray-400 hover:text-gray-600"
                                >
                                  {expandedGroups.has(groupName) ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )}
                                </button>
                              )}
                              <div>
                                <div className="text-gray-900 truncate max-w-48" title={group.base.name}>
                                  {group.base.name}
                                </div>
                                {group.base.pageName && (
                                  <div className="text-xs text-gray-400 mt-1">Page: {group.base.pageName}</div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="text-center">
                            {group.variants.length > 0 ? (
                              <span className="text-sm text-gray-600">
                                {group.variants.length}
                              </span>
                            ) : (
                              <span className="text-sm text-gray-400">-</span>
                            )}
                          </td>
                          <td>
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              (group.base.healthScore || 0) >= 80 ? 'bg-green-100 text-green-800' :
                              (group.base.healthScore || 0) >= 60 ? 'bg-yellow-100 text-yellow-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {group.base.healthScore || 0}%
                            </span>
                          </td>
                          <td>
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              group.base.isDeprecated ? 'bg-orange-100 text-orange-800' :
                              group.base.isOrphaned ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-800'
                            }`}>
                              {group.base.isDeprecated ? 'Deprecated' : group.base.isOrphaned ? 'Library Component' : 'Active'}
                            </span>
                          </td>
                        </tr>
                        
                        {/* Variant rows (expandable) */}
                        {expandedGroups.has(groupName) && group.variants.map((variant: any, variantIndex: number) => (
                          <tr key={`${groupName}-${variantIndex}`} className="bg-white">
                            <td className="w-8">
                              {variant.thumbnail_url ? (
                                <img 
                                  src={variant.thumbnail_url} 
                                  alt={variant.name}
                                  className="w-6 h-6 object-cover rounded border border-gray-200 bg-white"
                                  onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    target.style.display = 'none';
                                  }}
                                />
                              ) : (
                                <div className="w-6 h-6 bg-gray-100 rounded border border-gray-200 flex items-center justify-center">
                                  <FileText className="h-4 w-4 text-gray-400" />
                                </div>
                              )}
                            </td>
                            <td className="font-medium pl-8">
                              <div className="text-gray-700 text-sm truncate max-w-48" title={variant.name}>↳ {variant.name}</div>
                            </td>
                            <td className="text-center">
                              <span className="text-sm text-gray-400">-</span>
                            </td>
                            <td>
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                (variant.healthScore || 0) >= 80 ? 'bg-green-100 text-green-800' :
                                (variant.healthScore || 0) >= 60 ? 'bg-yellow-100 text-yellow-800' :
                                'bg-red-100 text-red-800'
                              }`}>
                                {variant.healthScore || 0}%
                              </span>
                            </td>
                            <td>
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                variant.isDeprecated ? 'bg-orange-100 text-orange-800' :
                                variant.isOrphaned ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-800'
                              }`}>
                                {variant.isDeprecated ? 'Deprecated' : variant.isOrphaned ? 'Library Component' : 'Active'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </>
                    ))}
                  </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Top 10 Most Used Components */}
            {topComponents.length > 0 && (
              <div className="card-enhanced p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Top 10 Most Used Components</h3>
                <div className="space-y-3">
                  {topComponents.map((component, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center justify-center w-6 h-6 bg-primary-500 text-white text-xs font-medium rounded-full">
                          {index + 1}
                        </span>
                        <span className="font-medium text-gray-900">{component.name}</span>
                      </div>
                      <span className="text-sm font-medium text-primary-600">{component.usageCount} uses</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Empty State Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <div className="card-enhanced p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Total Components</p>
                    <p className="text-2xl font-bold text-gray-300">--</p>
                  </div>
                  <div className="p-2 bg-gray-100 rounded-lg">
                    <FileText className="h-5 w-5 text-gray-400" />
                  </div>
                </div>
              </div>
              
              <div className="card-enhanced p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Well-Documented</p>
                    <p className="text-2xl font-bold text-gray-300">--</p>
                  </div>
                  <div className="p-2 bg-gray-100 rounded-lg">
                    <FileText className="h-5 w-5 text-gray-400" />
                  </div>
                </div>
              </div>
              
              <div className="card-enhanced p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Deprecated Components</p>
                    <p className="text-2xl font-bold text-gray-300">--</p>
                  </div>
                  <div className="p-2 bg-gray-100 rounded-lg">
                    <AlertCircle className="h-5 w-5 text-gray-400" />
                  </div>
                </div>
              </div>
              
              <div className="card-enhanced p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Recent Updates</p>
                    <p className="text-2xl font-bold text-gray-300">--</p>
                  </div>
                  <div className="p-2 bg-gray-100 rounded-lg">
                    <BarChart3 className="h-5 w-5 text-gray-400" />
                  </div>
                </div>
              </div>
            </div>

            {/* Export Button - Disabled */}
            <div className="flex justify-end mb-6">
              <button disabled className="btn-secondary-enhanced opacity-50 cursor-not-allowed">
                <Download className="h-4 w-4" />
                Export CSV
              </button>
            </div>

            {/* Empty State Component Table */}
            <div className="card-enhanced overflow-hidden mb-8">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Component Inventory</h3>
                <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-md text-left">
                  <div className="flex items-start gap-2">
                    <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-blue-700">
                      <p className="font-medium mb-1">Ready to Analyze</p>
                      <p>Enter your Figma Personal Access Token and File Key above, then click "Analyze Component Inventory" to populate this table with your component data, health scores, and quality metrics.</p>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <table className="table-enhanced">
                  <thead>
                    <tr>
                      <th className="w-8">Preview</th>
                      <th className="text-left">Component Name</th>
                      <th className="text-center">Variants</th>
                      <th>Health Score</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Empty state rows */}
                    {[1, 2, 3].map((index) => (
                      <tr key={index} className="bg-gray-50">
                        <td className="w-8">
                          <div className="w-6 h-6 bg-gray-200 rounded border border-gray-300 flex items-center justify-center">
                            <FileText className="h-4 w-4 text-gray-400" />
                          </div>
                        </td>
                        <td className="font-medium">
                          <div className="text-gray-400 text-sm">Component {index}</div>
                        </td>
                        <td className="text-center">
                          <span className="text-sm text-gray-400">--</span>
                        </td>
                        <td>
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-400">
                            --%
                          </span>
                        </td>
                        <td>
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-400">
                            --
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default App

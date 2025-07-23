/**
 * Manages pagination state and data loading for dynamic lists
 * @param {Object} instance - DynamicList instance
 */
function PaginationManager(instance) {
  this.instance = instance;
  this.reset();
}

/**
 * Reset pagination state to initial values
 */
PaginationManager.prototype.reset = function() {
  this.currentPage = 0;
  this.pageSize = this.instance.data.lazyLoadPageSize || 50;
  this.totalCount = 0;
  this.hasMore = true;
  this.loading = false;
  this.loadedPages = new Map();
  this.allLoadedItems = [];
  this.currentQuery = {};
  
  console.log('[PaginationManager] Reset with pageSize:', this.pageSize);
};

/**
 * Load a specific page of data
 * @param {Number} page - Page number (0-based)
 * @param {Object} options - Loading options
 * @returns {Promise} Promise that resolves with page data
 */
PaginationManager.prototype.loadPage = function(page, options) {
  options = options || {};
  
  if (this.loading) {
    console.log('[PaginationManager] Already loading, skipping request');
    return Promise.resolve({ records: [], fromCache: true });
  }

  // Check cache first
  var cacheKey = this.getCacheKey(page, options);
  if (this.loadedPages.has(cacheKey) && !options.forceRefresh) {
    console.log('[PaginationManager] Returning cached page:', page);
    return Promise.resolve({ 
      records: this.loadedPages.get(cacheKey),
      fromCache: true 
    });
  }

  console.log('[PaginationManager] Loading page:', page, 'with options:', options);
  console.log('[PaginationManager] FilterQuery being passed:', options.filterQuery);
  this.loading = true;
  var _this = this;
  
  return this.instance.Utils.Records.loadDataPaginated({
    config: this.instance.data,
    page: page,
    pageSize: this.pageSize,
    searchQuery: options.searchQuery,
    filterQuery: options.filterQuery,
    sortQuery: options.sortQuery,
    showBookmarks: options.showBookmarks
  }).then(function(result) {
    _this.loading = false;
    _this.totalCount = result.pagination.total;
    _this.hasMore = result.pagination.hasMore;
    
    console.log('[PaginationManager] Loaded page', page, '- records:', result.records.length, 'hasMore:', _this.hasMore);
    
    // Cache the page
    _this.loadedPages.set(cacheKey, result.records);
    
    // Update aggregated data
    if (options.append && page > 0) {
      _this.allLoadedItems = _this.allLoadedItems.concat(result.records);
    } else {
      _this.allLoadedItems = result.records;
      _this.currentPage = page;
    }
    
    return {
      records: result.records,
      pagination: result.pagination,
      fromCache: false
    };
  }).catch(function(error) {
    _this.loading = false;
    console.error('[PaginationManager] Error loading page:', error);
    throw error;
  });
};

/**
 * Load the next page of data
 * @param {Object} options - Loading options
 * @returns {Promise} Promise that resolves with next page data
 */
PaginationManager.prototype.loadNextPage = function(options) {
  options = options || {};
  
  if (!this.hasMore) {
    console.log('[PaginationManager] No more pages to load');
    return Promise.resolve({ records: [], fromCache: true });
  }
  
  var nextPage = this.currentPage + 1;
  options.append = true;
  
  return this.loadPage(nextPage, options).then(function(result) {
    if (!result.fromCache) {
      this.currentPage = nextPage;
    }
    return result;
  }.bind(this));
};

/**
 * Generate cache key for a page with given options
 * @param {Number} page - Page number
 * @param {Object} options - Query options
 * @returns {String} Cache key
 */
PaginationManager.prototype.getCacheKey = function(page, options) {
  var key = {
    page: page,
    searchQuery: options.searchQuery,
    filterQuery: options.filterQuery,
    sortQuery: options.sortQuery,
    showBookmarks: options.showBookmarks
  };
  return JSON.stringify(key);
};

/**
 * Invalidate all cached pages
 */
PaginationManager.prototype.invalidateCache = function() {
  console.log('[PaginationManager] Invalidating cache');
  this.loadedPages.clear();
  this.allLoadedItems = [];
};

/**
 * Get current query options
 * @returns {Object} Current query state
 */
PaginationManager.prototype.getCurrentQueryOptions = function() {
  return {
    searchQuery: this.currentQuery.searchQuery,
    filterQuery: this.currentQuery.filterQuery,
    sortQuery: this.currentQuery.sortQuery,
    showBookmarks: this.currentQuery.showBookmarks
  };
};

// Export for use in other files
if (typeof window !== 'undefined') {
  window.PaginationManager = PaginationManager;
} 
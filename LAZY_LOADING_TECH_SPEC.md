# Technical Specification: Server-Side Lazy Loading for Fliplet Dynamic Lists

## 1. Overview

**Objective**: Replace the current client-side "lazy rendering" with true server-side lazy loading to improve performance for large datasets by fetching data in pages rather than loading all records upfront.

**Current Implementation**: 
- Loads ALL data via `Utils.Records.loadData()` → `getDataFromDataSource()` → `connection.find(query)`
- Performs search/filter client-side on `this.listItems`
- Only rendering is batched (`INCREMENTAL_RENDERING_BATCH_SIZE = 100`)

**Target Implementation**:
- Load data in pages using DataSource API pagination (`limit`, `offset`, `includePagination`)
- Move search/filter operations to server-side queries
- Implement true lazy loading with scroll-triggered data fetching

## 2. Architecture Changes

### 2.1 Data Loading Transformation

```javascript
// Current: Load all data
connection.find(query) // Returns ALL records

// New: Paginated loading
connection.find({
  ...query,
  limit: pageSize,
  offset: currentPage * pageSize,
  includePagination: true
}) // Returns { data: [...], pagination: { total, hasMore, ... } }
```

### 2.2 State Management

**New Instance Properties**:
```javascript
// Pagination state
this.pagination = {
  currentPage: 0,
  pageSize: 50, // configurable
  totalCount: 0,
  hasMore: true,
  loading: false
};

// Data management
this.loadedPages = new Map(); // Cache for loaded pages
this.currentQuery = {}; // Active search/filter query
this.allLoadedItems = []; // Aggregated results from all loaded pages
```

### 2.3 Search & Filter Architecture

**Server-Side Query Building**:
```javascript
function buildServerQuery(options) {
  const { searchValue, activeFilters, sortField, sortOrder, showBookmarks } = options;
  
  let query = {
    limit: options.pageSize,
    offset: options.page * options.pageSize,
    includePagination: true
  };

  // Add search conditions
  if (searchValue) {
    query.where = {
      $or: searchFields.map(field => ({
        [`data.${field}`]: { $regex: searchValue, $options: 'i' }
      }))
    };
  }

  // Add filter conditions
  if (activeFilters && Object.keys(activeFilters).length) {
    query.where = {
      ...query.where,
      $filters: buildFilterArray(activeFilters)
    };
  }

  // Add sorting
  if (sortField && sortOrder !== 'none') {
    query.order = [[`data.${sortField}`, sortOrder.toUpperCase()]];
  }

  return query;
}
```

## 3. Implementation Plan

### Phase 1: Core Pagination Infrastructure

#### 3.1 Update Utils.Records.loadData()

**File**: `js/utils.js`

```javascript
/**
 * Load data with pagination support
 * @param {Object} options - Configuration options
 * @param {Number} options.page - Page number (0-based)
 * @param {Number} options.pageSize - Number of records per page  
 * @param {Boolean} options.append - Whether to append to existing data
 * @param {Object} options.searchQuery - Search parameters
 * @param {Object} options.filterQuery - Filter parameters
 */
function loadDataPaginated(options) {
  options = options || {};
  
  const config = options.config;
  const page = options.page || 0;
  const pageSize = options.pageSize || config.lazyLoadPageSize || 50;
  
  // Build server-side query
  const query = buildPaginatedQuery({
    config: config,
    page: page,
    pageSize: pageSize,
    searchQuery: options.searchQuery,
    filterQuery: options.filterQuery,
    sortQuery: options.sortQuery,
    bookmarkFilter: options.showBookmarks
  });

  return Fliplet.DataSources.connect(config.dataSourceId, { offline: true })
    .then(function(connection) {
      return connection.find(query);
    })
    .then(function(result) {
      return {
        records: result.data || result, // Handle both paginated and non-paginated responses
        pagination: result.pagination || {
          total: (result.data || result).length,
          hasMore: false,
          page: page,
          pageSize: pageSize
        }
      };
    });
}

/**
 * Build paginated query with search, filter, and sort conditions
 */
function buildPaginatedQuery(options) {
  var config = options.config;
  var page = options.page;
  var pageSize = options.pageSize;
  var searchQuery = options.searchQuery;
  var filterQuery = options.filterQuery;
  var sortQuery = options.sortQuery;
  
  var query = {
    limit: pageSize,
    offset: page * pageSize,
    includePagination: true
  };

  // Add search conditions
  if (searchQuery && searchQuery.value) {
    var searchConditions = searchQuery.fields.map(function(field) {
      var condition = {};
      condition['data.' + field] = { 
        $regex: searchQuery.value, 
        $options: 'i' 
      };
      return condition;
    });
    
    if (searchConditions.length > 1) {
      query.where = { $or: searchConditions };
    } else if (searchConditions.length === 1) {
      query.where = searchConditions[0];
    }
  }

  // Add filter conditions
  if (filterQuery && filterQuery.filters && Object.keys(filterQuery.filters).length) {
    var filterConditions = buildFilterConditions(filterQuery.filters, filterQuery.types);
    
    if (filterConditions.length) {
      query.where = query.where || {};
      query.where.$filters = filterConditions;
    }
  }

  // Add bookmark filter
  if (options.showBookmarks) {
    // This would need to be implemented based on bookmark storage strategy
    // Placeholder for bookmark filtering logic
  }

  // Add sorting
  if (sortQuery && sortQuery.field && sortQuery.order !== 'none') {
    query.order = [['data.' + sortQuery.field, sortQuery.order.toUpperCase()]];
  } else {
    // Default sorting
    query.order = [
      ['order', 'ASC'],
      ['id', 'ASC']
    ];
  }

  return query;
}

/**
 * Convert active filters to server-side filter conditions
 */
function buildFilterConditions(activeFilters, filterTypes) {
  var conditions = [];
  
  Object.keys(activeFilters).forEach(function(field) {
    var values = activeFilters[field];
    var filterType = filterTypes[field];
    
    switch (filterType) {
      case 'date':
        conditions.push(buildDateFilterCondition(field, values));
        break;
      case 'number':
        conditions.push(buildNumberFilterCondition(field, values));
        break;
      default:
        conditions.push({
          column: field,
          condition: 'IN',
          value: Array.isArray(values) ? values : [values]
        });
    }
  });
  
  return conditions;
}
```

#### 3.2 New Pagination Manager

**File**: `js/pagination-manager.js`

```javascript
/**
 * Manages pagination state and data loading for dynamic lists
 */
function PaginationManager(instance) {
  this.instance = instance;
  this.reset();
}

PaginationManager.prototype.reset = function() {
  this.currentPage = 0;
  this.pageSize = this.instance.data.lazyLoadPageSize || 50;
  this.totalCount = 0;
  this.hasMore = true;
  this.loading = false;
  this.loadedPages = new Map();
  this.allLoadedItems = [];
  this.currentQuery = {};
};

PaginationManager.prototype.loadPage = function(page, options) {
  options = options || {};
  
  if (this.loading) {
    return Promise.resolve({ records: [], fromCache: true });
  }

  // Check cache first
  var cacheKey = this.getCacheKey(page, options);
  if (this.loadedPages.has(cacheKey) && !options.forceRefresh) {
    return Promise.resolve({ 
      records: this.loadedPages.get(cacheKey),
      fromCache: true 
    });
  }

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
    
    // Cache the page
    _this.loadedPages.set(cacheKey, result.records);
    
    // Update aggregated data
    if (options.append) {
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
    throw error;
  });
};

PaginationManager.prototype.getCacheKey = function(page, options) {
  return JSON.stringify({
    page: page,
    searchQuery: options.searchQuery,
    filterQuery: options.filterQuery,
    sortQuery: options.sortQuery,
    showBookmarks: options.showBookmarks
  });
};

PaginationManager.prototype.invalidateCache = function() {
  this.loadedPages.clear();
  this.allLoadedItems = [];
};
```

### Phase 2: Search & Filter Server-Side Implementation

#### 3.3 Update Search Implementation

**File**: `js/layout-javascript/simple-list-code.js`

```javascript
DynamicList.prototype.searchData = function(options) {
  options = options || {};
  
  var _this = this;
  var value = options.value || '';
  var resetPagination = options.resetPagination !== false;
  
  // Update search state
  _this.searchValue = value;
  _this.isSearching = value !== '';
  
  // Reset pagination for new search
  if (resetPagination) {
    _this.paginationManager.reset();
  }
  
  // Build search query
  var searchQuery = {
    value: value,
    fields: options.fields || _this.data.searchFields
  };
  
  return _this.loadDataWithCurrentState({
    searchQuery: searchQuery,
    append: !resetPagination,
    initialRender: options.initialRender
  });
};

DynamicList.prototype.loadDataWithCurrentState = function(options) {
  options = options || {};
  
  var _this = this;
  
  // Get current filter state
  var activeFilters = _this.Utils.Page.getActiveFilters({ $container: _this.$container });
  var showBookmarks = _this.$container.find('.toggle-bookmarks').hasClass('mixitup-control-active');
  
  // Build comprehensive query
  var queryOptions = {
    searchQuery: options.searchQuery || { 
      value: _this.searchValue, 
      fields: _this.data.searchFields 
    },
    filterQuery: { 
      filters: activeFilters, 
      types: _this.filterTypes 
    },
    sortQuery: { 
      field: _this.sortField, 
      order: _this.sortOrder 
    },
    showBookmarks: showBookmarks,
    append: options.append || false
  };
  
  return _this.paginationManager.loadPage(_this.paginationManager.currentPage, queryOptions)
    .then(function(result) {
      if (!result.fromCache) {
        _this.updateUIWithResults(result.records, queryOptions);
      }
      
      return result;
    });
};

DynamicList.prototype.updateUIWithResults = function(records, queryOptions) {
  var _this = this;
  
  // Add summary data for rendering
  var modifiedData = _this.addSummaryData(records);
  
  if (!queryOptions.append) {
    // Clear existing results for new search/filter
    $('#simple-list-wrapper-' + _this.data.id).empty();
    _this.modifiedListItems = modifiedData;
  } else {
    // Append new results
    _this.modifiedListItems = _this.modifiedListItems.concat(modifiedData);
  }
  
  // Render the data
  return _this.renderLoopSegment({
    data: modifiedData,
    append: queryOptions.append
  }).then(function(renderedRecords) {
    // Update UI state
    _this.$container.find('.simple-list-container').removeClass('loading').addClass('ready');
    _this.$container.find('.simple-list-container').toggleClass('no-results', !_this.modifiedListItems.length);
    
    // Setup lazy loading observer for new records
    if (renderedRecords.length && _this.paginationManager.hasMore) {
      _this.attachLazyLoadObserver({
        renderedRecords: renderedRecords
      });
    }
    
    // Initialize social features
    return _this.initializeSocials(renderedRecords);
  });
};
```

### Phase 3: Lazy Loading with Scroll Detection

#### 3.4 Enhanced Intersection Observer

**File**: `js/layout-javascript/simple-list-code.js`

```javascript
DynamicList.prototype.attachLazyLoadObserver = function(options) {
  options = options || {};
  
  var _this = this;
  var renderedRecords = options.renderedRecords || [];
  
  if (!renderedRecords.length || !('IntersectionObserver' in window)) {
    return;
  }
  
  // Calculate trigger point (load next page when 90% through current page)
  var triggerIndex = Math.floor(renderedRecords.length * 0.9);
  var triggerRecord = renderedRecords[triggerIndex];
  
  if (!triggerRecord) {
    return;
  }
  
  var $triggerEntry = _this.$container.find('.simple-list-item[data-entry-id="' + triggerRecord.id + '"]');
  
  if (!$triggerEntry.length) {
    return;
  }
  
  // Disconnect previous observer if exists
  if (_this.lazyLoadObserver) {
    _this.lazyLoadObserver.disconnect();
  }
  
  _this.lazyLoadObserver = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (!entry.isIntersecting || 
          _this.paginationManager.loading || 
          !_this.paginationManager.hasMore) {
        return;
      }
      
      _this.lazyLoadObserver.disconnect();
      _this.loadNextPage();
    });
  }, {
    threshold: 0.1,
    rootMargin: '100px' // Start loading 100px before the trigger point
  });
  
  requestAnimationFrame(function() {
    _this.lazyLoadObserver.observe($triggerEntry.get(0));
  });
};

DynamicList.prototype.loadNextPage = function() {
  var _this = this;
  
  if (!_this.paginationManager.hasMore || _this.paginationManager.loading) {
    return Promise.resolve();
  }
  
  _this.paginationManager.currentPage++;
  
  // Show loading indicator
  _this.showLoadingIndicator();
  
  return _this.loadDataWithCurrentState({
    append: true
  }).then(function(result) {
    _this.hideLoadingIndicator();
    
    if (result.records.length) {
      return _this.renderLoopSegment({
        data: _this.addSummaryData(result.records),
        append: true
      });
    }
    
    return [];
  }).then(function(renderedRecords) {
    if (renderedRecords.length) {
      _this.attachLazyLoadObserver({
        renderedRecords: renderedRecords
      });
      
      return _this.initializeSocials(renderedRecords);
    }
  }).catch(function(error) {
    _this.hideLoadingIndicator();
    _this.handleLoadError(error, { isInitialLoad: false });
  });
};

DynamicList.prototype.showLoadingIndicator = function() {
  var loadingHTML = '<div class="lazy-loading-indicator" style="text-align:center;padding:20px;"><i class="fa fa-circle-o-notch fa-spin"></i> Loading more...</div>';
  this.$container.find('.simple-list-wrapper').append(loadingHTML);
};

DynamicList.prototype.hideLoadingIndicator = function() {
  this.$container.find('.lazy-loading-indicator').remove();
};
```

#### 3.5 Enhanced renderLoopSegment for Append Mode

```javascript
DynamicList.prototype.renderLoopSegment = function(options) {
  options = options || {};

  var _this = this;
  var data = options.data;
  var append = options.append || false;
  var renderLoopIndex = 0;
  var template = this.data.advancedSettings && this.data.advancedSettings.loopHTML
    ? Handlebars.compile(this.data.advancedSettings.loopHTML)
    : Handlebars.compile(Fliplet.Widget.Templates[this.layoutMapping[this.data.layout]['loop']]());

  return new Promise(function(resolve) {
    function render() {
      // get the next batch of items to render
      var nextBatch = data.slice(
        renderLoopIndex * _this.INCREMENTAL_RENDERING_BATCH_SIZE,
        renderLoopIndex * _this.INCREMENTAL_RENDERING_BATCH_SIZE + _this.INCREMENTAL_RENDERING_BATCH_SIZE
      );

      if (nextBatch.length) {
        var renderedHTML = template(nextBatch);
        
        if (append) {
          $('#simple-list-wrapper-' + _this.data.id).append(renderedHTML);
        } else {
          if (renderLoopIndex === 0) {
            $('#simple-list-wrapper-' + _this.data.id).html(renderedHTML);
          } else {
            $('#simple-list-wrapper-' + _this.data.id).append(renderedHTML);
          }
        }
        
        renderLoopIndex++;
        // if the browser is ready, render
        requestAnimationFrame(render);
      } else {
        resolve(data);
      }
    }

    // start the initial render
    requestAnimationFrame(render);
  });
};
```

## 4. Backward Compatibility & Migration

### 4.1 Configuration Options

**New Configuration Properties**:
```javascript
{
  // Lazy loading settings
  enableServerSideLazyLoading: true, // Feature flag
  lazyLoadPageSize: 50,              // Records per page
  lazyLoadStrategy: 'intersection',  // 'intersection' | 'scroll' | 'button'
  
  // Compatibility mode
  legacyMode: false,                 // Fall back to current implementation
  
  // Performance settings
  cachePages: true,                  // Cache loaded pages
  prefetchNextPage: false,           // Load next page in background
  
  // Search/filter behavior
  serverSideSearch: true,            // Use server-side search
  serverSideFilters: true,           // Use server-side filters
  searchDebounceMs: 300,             // Debounce search input
}
```

### 4.2 Feature Detection & Fallback

```javascript
DynamicList.prototype.initialize = function() {
  var _this = this;
  var shouldInitFromQuery = _this.parseQueryVars();
  
  // query will always have higher priority than storage
  if (shouldInitFromQuery) {
    Fliplet.App.Storage.remove('flDynamicListQuery:' + _this.data.layout);
  }

  _this.attachObservers();
  
  // Determine if lazy loading should be enabled
  var shouldUseLazyLoading = _this.shouldEnableLazyLoading();
  
  return (shouldInitFromQuery ? Promise.resolve() : _this.parsePVQueryVars())
    .then(function() {
      // Render Base HTML template
      _this.renderBaseHTML();
      // Determine filter types from configuration
      _this.filterTypes = _this.Utils.getFilterTypes({ instance: _this });

      return _this.Utils.Records.setFilterValues({
        config: _this.data
      });
    })
    .then(function() {
      if (shouldUseLazyLoading) {
        _this.paginationManager = new PaginationManager(_this);
        return _this.initializeWithLazyLoading();
      } else {
        return _this.initializeLegacyMode();
      }
    });
};

DynamicList.prototype.shouldEnableLazyLoading = function() {
  // Check if server-side lazy loading is supported
  return !!(
    this.data.enableServerSideLazyLoading &&
    this.data.dataSourceId &&
    !this.data.legacyMode &&
    !this.hasUnsupportedFeatures()
  );
};

DynamicList.prototype.hasUnsupportedFeatures = function() {
  // Features that require all data to be loaded upfront
  return !!(
    typeof this.data.getData === 'function' ||      // Custom data loading
    typeof this.data.searchData === 'function' ||   // Custom search
    !_.isEmpty(this.data.computedFields) ||          // Computed fields
    this.data.layout === 'agenda'                    // Agenda layout needs special handling
  );
};

DynamicList.prototype.initializeWithLazyLoading = function() {
  var _this = this;
  
  // Load first page
  return _this.loadDataWithCurrentState({
    initialRender: true
  }).then(function() {
    _this.parseFilterQueries();
    _this.changeSort();
    return _this.parseSearchQueries();
  });
};

DynamicList.prototype.initializeLegacyMode = function() {
  // Existing initialization logic
  var _this = this;
  
  return _this.Utils.Records.loadData({
    instance: _this,
    config: _this.data,
    id: _this.data.id,
    uuid: _this.data.uuid,
    $container: _this.$container,
    filterQueries: _this.queryPreFilter ? _this.pvPreFilterQuery : undefined
  }).then(function(records) {
    // Continue with existing logic...
    _this.Utils.Records.addComputedFields({
      records: records,
      config: _this.data,
      filterTypes: _this.filterTypes
    });

    return Fliplet.Hooks.run('flListDataAfterGetData', {
      instance: _this,
      config: _this.data,
      id: _this.data.id,
      uuid: _this.data.uuid,
      container: _this.$container,
      records: records
    }).then(function() {
      if (records && !Array.isArray(records)) {
        records = [records];
      }

      return _this.Utils.Records.prepareData({
        records: records,
        config: _this.data,
        filterQueries: _this.queryPreFilter ? _this.pvPreFilterQuery : undefined
      });
    });
  }).then(function(records) {
    _this.listItems = _this.getPermissions(records);

    if (!_this.data.detailViewAutoUpdate) {
      return Promise.resolve();
    }

    return _this.Utils.Records.getFields(_this.listItems, _this.data.dataSourceId).then(function(columns) {
      _this.dataSourceColumns = columns;
    });
  }).then(function() {
    return _this.Utils.Records.updateFiles({
      records: _this.listItems,
      config: _this.data
    });
  }).then(function(response) {
    _this.listItems = _.uniqBy(response, 'id');

    return _this.checkIsToOpen();
  }).then(function() {
    _this.modifiedListItems = _this.Utils.Records.addFilterProperties({
      records: _this.listItems,
      config: _this.data,
      filterTypes: _this.filterTypes,
      filterQuery: _this.queryFilter ? _this.pvFilterQuery : undefined
    });

    return _this.addFilters(_this.modifiedListItems);
  }).then(function() {
    _this.parseFilterQueries();
    _this.changeSort();
    return _this.parseSearchQueries();
  });
};
```

## 5. Error Handling & Performance

### 5.1 Error Recovery

```javascript
DynamicList.prototype.handleLoadError = function(error, options) {
  console.error('[LFD] Lazy loading error:', error);
  
  // Track the error
  Fliplet.Analytics.trackEvent({
    category: 'list_dynamic_lazy_loading',
    action: 'load_error',
    label: error.message
  });
  
  // Show user-friendly error
  if (options.isInitialLoad) {
    Fliplet.UI.Toast.error(T('widgets.list.dynamic.errors.loadFailed'));
    // Fall back to legacy mode
    return this.initializeLegacyMode();
  } else {
    // For pagination errors, just stop loading more
    this.paginationManager.hasMore = false;
    this.paginationManager.loading = false;
    
    // Show retry option
    this.showRetryOption();
  }
};

DynamicList.prototype.showRetryOption = function() {
  var retryHTML = '<div class="lazy-load-error" style="text-align:center;padding:20px;"><p>Failed to load more items</p><button class="btn btn-default retry-load">Retry</button></div>';
  this.$container.find('.simple-list-wrapper').append(retryHTML);
  
  var _this = this;
  this.$container.find('.retry-load').on('click', function() {
    _this.$container.find('.lazy-load-error').remove();
    _this.paginationManager.hasMore = true;
    _this.loadNextPage();
  });
};
```

### 5.2 Performance Optimizations

```javascript
// Debounced search
DynamicList.prototype.setupDebouncedSearch = function() {
  var _this = this;
  
  _this.debouncedSearch = _.debounce(function(value) {
    _this.searchData({ value: value, resetPagination: true });
  }, _this.data.searchDebounceMs || 300);
};

// Prefetch next page
DynamicList.prototype.prefetchNextPage = function() {
  if (!this.data.prefetchNextPage || 
      this.paginationManager.loading || 
      !this.paginationManager.hasMore) {
    return;
  }
  
  var nextPage = this.paginationManager.currentPage + 1;
  
  // Load in background without updating UI
  this.paginationManager.loadPage(nextPage, {
    ...this.getCurrentQueryOptions(),
    silent: true
  });
};

DynamicList.prototype.getCurrentQueryOptions = function() {
  var activeFilters = this.Utils.Page.getActiveFilters({ $container: this.$container });
  var showBookmarks = this.$container.find('.toggle-bookmarks').hasClass('mixitup-control-active');
  
  return {
    searchQuery: { 
      value: this.searchValue, 
      fields: this.data.searchFields 
    },
    filterQuery: { 
      filters: activeFilters, 
      types: this.filterTypes 
    },
    sortQuery: { 
      field: this.sortField, 
      order: this.sortOrder 
    },
    showBookmarks: showBookmarks
  };
};
```

### 5.3 Cache Management

```javascript
DynamicList.prototype.setupCacheManagement = function() {
  var _this = this;
  
  // Clear cache when filters/search changes
  _this.$container.on('filter-changed search-changed', function() {
    _this.paginationManager.invalidateCache();
  });
  
  // Cleanup on destroy
  if (typeof _this.destroy === 'function') {
    var originalDestroy = _this.destroy;
    _this.destroy = function() {
      if (_this.lazyLoadObserver) {
        _this.lazyLoadObserver.disconnect();
      }
      _this.paginationManager.invalidateCache();
      return originalDestroy.apply(_this, arguments);
    };
  }
};
```

## 6. Testing Strategy

### 6.1 Unit Tests
- **Pagination Manager**: State management, cache invalidation, error handling
- **Query Building**: Search/filter to server-side query conversion
- **Feature Detection**: Proper fallback to legacy mode
- **Error Scenarios**: Network failures, invalid responses

### 6.2 Integration Tests  
- **End-to-end Lazy Loading**: Real data source with pagination
- **Search/Filter Functionality**: Server-side vs client-side consistency
- **Backward Compatibility**: Existing configurations work unchanged
- **Performance**: Memory usage, render times, scroll smoothness

### 6.3 Edge Cases
- **Empty Datasets**: Proper UI state handling
- **Single Page Results**: No infinite loading attempts
- **Network Failures**: Graceful degradation and retry
- **Rapid Input Changes**: Debouncing and request cancellation
- **Filter Changes While Loading**: State consistency

### 6.4 Performance Benchmarks
```javascript
// Test scenarios
const testScenarios = [
  { name: 'Small Dataset', recordCount: 100 },
  { name: 'Medium Dataset', recordCount: 1000 },
  { name: 'Large Dataset', recordCount: 10000 },
  { name: 'Search Heavy', recordCount: 5000, searchOperations: 50 },
  { name: 'Filter Heavy', recordCount: 5000, filterOperations: 30 }
];

// Metrics to track
const metrics = [
  'Initial load time',
  'Time to first render',
  'Memory usage at initialization', 
  'Memory usage after 5 pages',
  'Search response time',
  'Filter response time',
  'Scroll smoothness (FPS)',
  'Cache hit rate'
];
```

## 7. Rollout Plan

### Phase 1: Core Infrastructure (Week 1-2)
- [ ] Implement `PaginationManager` class
- [ ] Update `Utils.Records.loadData()` with pagination support
- [ ] Create server-side query building utilities
- [ ] Add configuration options and feature detection
- [ ] Unit tests for core components

### Phase 2: Search & Filter (Week 3-4)  
- [ ] Server-side search implementation
- [ ] Server-side filter implementation
- [ ] Update UI state management for paginated data
- [ ] Debounced search input handling
- [ ] Integration tests for search/filter

### Phase 3: Lazy Loading UI (Week 5)
- [ ] Enhanced intersection observer implementation
- [ ] Loading indicators and error states
- [ ] Smooth scroll-triggered data loading
- [ ] Cache management and optimization
- [ ] Performance testing and optimization

### Phase 4: Polish & Compatibility (Week 6)
- [ ] Backward compatibility testing
- [ ] Error handling and fallback mechanisms
- [ ] Documentation and configuration guides
- [ ] Code review and refinements

### Phase 5: Gradual Rollout (Week 7-8)
- [ ] Feature flag implementation for beta testing
- [ ] Performance monitoring and analytics
- [ ] Bug fixes based on beta feedback
- [ ] Full production rollout

## 8. Success Metrics

### Performance Targets
- **Initial Load Time**: < 2s for first page vs. current full load time
- **Memory Usage**: 50% reduction for large datasets (>1000 records)
- **Time to Interactive**: < 1s for first page render
- **Search Performance**: < 500ms for server-side search results
- **Scroll Performance**: Maintain 60 FPS during lazy loading

### User Experience Metrics
- **Perceived Performance**: Users should not notice loading delays
- **Error Rate**: < 1% pagination failures
- **Cache Hit Rate**: > 80% for repeated queries
- **Bandwidth Usage**: 70% reduction in initial data transfer

### Compatibility Metrics
- **Backward Compatibility**: 100% of existing configurations work
- **Feature Parity**: All current features available in lazy loading mode
- **Fallback Success**: Graceful degradation to legacy mode when needed

## 9. Implementation Notes

### 9.1 Fliplet DataSource API Usage
Based on the Fliplet documentation, the implementation will leverage:

```javascript
// Pagination with cursor support
connection.findWithCursor({
  where: { /* search/filter conditions */ },
  limit: 50,
  order: [['data.fieldName', 'ASC']]
});

// Or traditional pagination
connection.find({
  where: { /* conditions */ },
  limit: 50,
  offset: pageNumber * 50,
  includePagination: true
});
```

### 9.2 Query Optimization
- Use `$filters` for complex filter conditions
- Leverage `$or` and `$and` operators for search across multiple fields
- Utilize proper indexing on frequently queried columns
- Implement query result caching for identical requests

### 9.3 Memory Management
- Implement virtual scrolling for very large datasets
- Use `WeakMap` for temporary caches that can be garbage collected
- Periodically clean up old cached pages
- Monitor memory usage and implement warnings for excessive growth

### 9.4 Hook Compatibility Implementation

The `flListDataAfterGetData` hook has been updated to work with lazy loading:

```javascript
// In updateUIWithResults() method - simple-list-code.js:1430
return Fliplet.Hooks.run('flListDataAfterGetData', {
  instance: _this,
  config: _this.data,
  id: _this.data.id,
  uuid: _this.data.uuid,
  container: _this.$container,
  records: records, // Current page records
  // NEW: Pagination context
  pagination: {
    isPagedData: true,
    currentPage: _this.paginationManager.currentPage,
    pageSize: _this.paginationManager.pageSize,
    hasMore: _this.paginationManager.hasMore,
    append: queryOptions.append
  }
}).then(function(hookResult) {
  // Hook can modify records by returning { records: modifiedRecords }
  var processedRecords = hookResult && hookResult.records ? hookResult.records : records;
  // Continue with processing...
});
```

**Hook Handler Adaptation:**
```javascript
// Example hook handler that works with both legacy and lazy loading
Fliplet.Hooks.on('flListDataAfterGetData', function(data) {
  if (data.pagination && data.pagination.isPagedData) {
    // Handle paginated data - process each page
    console.log('Processing page', data.pagination.currentPage, 'with', data.records.length, 'records');
  } else {
    // Handle legacy data - all records at once
    console.log('Processing all', data.records.length, 'records');
  }
  
  // Modify records if needed
  var modifiedRecords = data.records.map(function(record) {
    // Apply transformations
    return record;
  });
  
  return Promise.resolve({ records: modifiedRecords });
});
```

**Feature Detection Update:**
```javascript
// utils.js:1021 - Updated to allow hooks with lazy loading
if (Fliplet.Hooks.has('flListDataAfterGetData') && config.disableLazyLoadingForHooks) {
  reasons.push('afterGetDataHook'); // Only disable if explicitly configured
}
```

This implementation provides a comprehensive solution for true server-side lazy loading while maintaining full backward compatibility and providing a smooth user experience. 
/**
 * This gets data out of the URL as an INPUT,
 * parses it, and as an OUTPUT sets all the required variables used by LFD
 * for prepopulating, prefiltering and opening an entry
 *
 * Note: Boolean flags are treated as strings as Fliplet.Navigate.query
 * does not parse the values into boolean values.
 */
Fliplet.Registry.set('dynamicListQueryParser', function() {
  var _this = this;

  if (Fliplet.Env.get('mode') === 'interact') {
    // Don't parse queries when editing in Studio
    return false;
  }

  // we do not execute previousScreen like in the PV case so we don't open ourselves up to an xss attack
  this.previousScreen = Fliplet.Navigate.query['dynamicListPreviousScreen'] === 'true';

  // action is intentionally ommited so we don't open ourselves up to an xss attack
  this.pvGoBack = _.pickBy({
    enableButton: Fliplet.Navigate.query['dynamicListEnableButton'],
    hijackBack: Fliplet.Navigate.query['dynamicListHijackBack']
  });
  this.queryGoBack = _(this.pvGoBack).size() > 0;

  // cast to booleans
  this.pvGoBack.enableButton = this.pvGoBack.enableButton === 'true';
  this.pvGoBack.hijackBack = this.pvGoBack.hijackBack === 'true';
  this.pvGoBack = this.queryGoBack ? this.pvGoBack : null;

  // example input
  // ?dynamicListPrefilterColumn=Name,Age&dynamicListPrefilterLogic=contains,<&dynamicListPrefilterValue=Angel,2
  this.pvPreFilterQuery = _.pickBy({
    column: Fliplet.Navigate.query['dynamicListPrefilterColumn'],
    logic: Fliplet.Navigate.query['dynamicListPrefilterLogic'],
    value: Fliplet.Navigate.query['dynamicListPrefilterValue']
  });
  this.queryPreFilter = _(this.pvPreFilterQuery).size() > 0;

  if (this.queryPreFilter) {
    // take the query parameters and parse them down to arrays
    var prefilterColumnParts = _this.Utils.String.splitByCommas(this.pvPreFilterQuery.column);
    var prefilterLogicParts = _this.Utils.String.splitByCommas(this.pvPreFilterQuery.logic);
    var prefilterValueParts = _this.Utils.String.splitByCommas(this.pvPreFilterQuery.value);

    if (prefilterColumnParts.length !== prefilterLogicParts.length
      || prefilterLogicParts.length !== prefilterValueParts.length) {
      this.pvPreFilterQuery = null;
      this.queryPreFilter = false;
      console.warn('Please supply an equal number of parameter to the dynamicListPrefilter filters.');
    } else {
      this.pvPreFilterQuery = [];

      var maxPartCount = Math.max(
        prefilterColumnParts.length,
        prefilterLogicParts.length,
        prefilterValueParts.length
      );

      // loop through the query parts and create new filters with every one
      for (var i = 0; i < maxPartCount; i++) {
        var filter = {
          column: prefilterColumnParts.pop(),
          logic: prefilterLogicParts.pop(),
          value: prefilterValueParts.pop()
        };

        this.pvPreFilterQuery.push(filter);
      }
    }
  } else {
    this.pvPreFilterQuery = null;
  }

  // dataSourceEntryId is always numeric
  // we cast the one coming from query to a number
  // so the equality check later passes
  this.pvOpenQuery = _.pickBy({
    id: parseInt(Fliplet.Navigate.query['dynamicListOpenId'], 10),
    column: Fliplet.Navigate.query['dynamicListOpenColumn'],
    value: Fliplet.Navigate.query['dynamicListOpenValue'],
    openComments: (('' + Fliplet.Navigate.query['dynamicListOpenComments']) || '').toLowerCase() === 'true',
    commentId: parseInt(Fliplet.Navigate.query['dynamicListCommentId'], 10)
  });
  this.queryOpen = _(this.pvOpenQuery).size() > 0;
  this.pvOpenQuery = this.queryOpen ? this.pvOpenQuery : null;

  this.pvSearchQuery = _.pickBy({
    column: Fliplet.Navigate.query['dynamicListSearchColumn'],
    value: Fliplet.Navigate.query['dynamicListSearchValue'],
    openSingleEntry: Fliplet.Navigate.query['dynamicListOpenSingleEntry']
  });

  const hasSearchQueryValue = !_.isUndefined(_.get(this.pvSearchQuery, 'value'));

  // Determine if query-based search should be active
  // If user has disabled search in settings, then no search query should be parsed and processed
  this.querySearch = this.data.searchEnabled && hasSearchQueryValue;

  if (this.querySearch) {
    // check if a comma separated list of columns were passed as column
    this.pvSearchQuery.column = _this.Utils.String.splitByCommas(this.pvSearchQuery.column, false);
    this.pvSearchQuery.openSingleEntry = (('' + this.pvSearchQuery.openSingleEntry) || '').toLowerCase() === 'true';
  } else {
    this.pvSearchQuery = this.data.searchEnabled ? this.pvSearchQuery : null;
    this.querySearch = null;
  }

  this.pvFilterQuery = _.pickBy({
    column: Fliplet.Navigate.query['dynamicListFilterColumn'],
    value: Fliplet.Navigate.query['dynamicListFilterValue'],
    hideControls: Fliplet.Navigate.query['dynamicListFilterHideControls']
  });

  const hasFilterQueryValue = !_.isUndefined(_.get(this.pvFilterQuery, 'value'));

  this.queryFilter = this.data.filtersEnabled && hasFilterQueryValue;

  if (this.queryFilter) {
    // check if a comma separated list of columns/values were passed as column/value
    this.pvFilterQuery.column = _this.Utils.String.splitByCommas(this.pvFilterQuery.column);
    this.pvFilterQuery.value = _this.Utils.String.splitByCommas(this.pvFilterQuery.value);

    if (!_.isEmpty(this.pvFilterQuery.column) && !_.isEmpty(this.pvFilterQuery.value)
      && this.pvFilterQuery.column.length !== this.pvFilterQuery.value.length) {
      this.pvFilterQuery.column = undefined;
      this.pvFilterQuery.value = undefined;
      this.queryFilter = false;
      console.warn('Please supply an equal number of parameter to the dynamicListFilterColumn and dynamicListFilterValue.');
    }

    // cast to boolean
    this.pvFilterQuery.hideControls = (('' + this.pvFilterQuery.hideControls) || '').toLowerCase() === 'true';
    this.data.filtersEnabled = this.data.filtersEnabled || this.queryFilter;
  } else {
    this.pvFilterQuery = this.data.filtersEnabled ? this.pvFilterQuery : null;
    this.queryFilter = null;
  }

  // We can sort only by one column that is why this syntax doesn't support
  // ?dynamicListSortColumn=Name,Age&dynamicListSortOrder=asc
  // Correct example is
  // ?dynamicListSortColumn=Name&dynamicListSortOrder=asc
  this.pvPreSortQuery = _.pickBy({
    column: Fliplet.Navigate.query['dynamicListSortColumn'],
    order: Fliplet.Navigate.query['dynamicListSortOrder']
  });

  if (!this.data.sortEnabled) {
    this.pvPreSortQuery = null;
  } else if (this.pvPreSortQuery.order) {
    // Validate sort queries
    this.pvPreSortQuery.order = this.pvPreSortQuery.order.toLowerCase().trim();

    if (!this.pvPreSortQuery.column
      || ['asc', 'desc'].indexOf(this.pvPreSortQuery.order) === -1) {
      this.pvPreSortQuery = {};
    }
  }

  this.querySort = _(this.pvPreSortQuery).size() === 2;

  if (this.querySort) {
    // Ensures sorting is configured correctly to match the query
    this.data.sortEnabled = true;
    this.data.sortFields = _.uniq(_.concat(this.data.sortFields, [this.pvPreSortQuery.column]));
    this.data.searchIconsEnabled = true;

    this.sortOrder = this.pvPreSortQuery.order || 'asc';
    this.sortField = this.pvPreSortQuery.column;
  }

  return this.previousScreen
    || this.queryGoBack
    || this.queryPreFilter
    || this.queryOpen
    || this.querySearch
    || this.queryFilter;
});

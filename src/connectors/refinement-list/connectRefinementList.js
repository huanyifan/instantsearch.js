import { createShowMore } from '../../lib/enhancers';
import {
  checkRendering,
  createDocumentationMessageGenerator,
  noop,
} from '../../lib/utils';
import {
  escapeFacets,
  TAG_PLACEHOLDER,
  TAG_REPLACEMENT,
} from '../../lib/escape-highlight';

const withUsage = createDocumentationMessageGenerator({
  name: 'refinement-list',
  connector: true,
});

/**
 * @typedef {Object} RefinementListItem
 * @property {string} value The value of the refinement list item.
 * @property {string} label Human-readable value of the refinement list item.
 * @property {number} count Number of matched results after refinement is applied.
 * @property {boolean} isRefined Indicates if the list item is refined.
 */

/**
 * @typedef {Object} CustomRefinementListWidgetOptions
 * @property {string} attribute The name of the attribute in the records.
 * @property {"and"|"or"} [operator = 'or'] How the filters are combined together.
 * @property {number} [limit = 10] The max number of items to display when
 * `showMoreLimit` is not set or if the widget is showing less value.
 * @property {boolean} [showMore = false] Whether to display a button that expands the number of items.
 * @property {number} [showMoreLimit = 20] The max number of items to display if the widget
 * is showing more items.
 * @property {string[]|function} [sortBy = ['isRefined', 'count:desc', 'name:asc']] How to sort refinements. Possible values: `count|isRefined|name:asc|name:desc`.
 * @property {boolean} [escapeFacetValues = true] Escapes the content of the facet values.
 * @property {function(object[]):object[]} [transformItems] Function to transform the items passed to the templates.
 */

/**
 * @typedef {Object} RefinementListRenderingOptions
 * @property {RefinementListItem[]} items The list of filtering values returned from Algolia API.
 * @property {function(item.value): string} createURL Creates the next state url for a selected refinement.
 * @property {function(item.value)} refine Action to apply selected refinements.
 * @property {function} searchForItems Searches for values inside the list.
 * @property {boolean} isFromSearch `true` if the values are from an index search.
 * @property {boolean} canRefine `true` if a refinement can be applied.
 * @property {boolean} canToggleShowMore `true` if the toggleShowMore button can be activated (enough items to display more or
 * already displaying more than `limit` items)
 * @property {Object} widgetParams All original `CustomRefinementListWidgetOptions` forwarded to the `renderFn`.
 * @property {boolean} isShowingMore True if the menu is displaying all the menu items.
 * @property {function} toggleShowMore Toggles the number of values displayed between `limit` and `showMoreLimit`.
 */

/**
 * **RefinementList** connector provides the logic to build a custom widget that will let the
 * user filter the results based on the values of a specific facet.
 *
 * This connector provides a `toggleShowMore()` function to display more or less items and a `refine()`
 * function to select an item.
 * @type {Connector}
 * @param {function(RefinementListRenderingOptions, boolean)} renderFn Rendering function for the custom **RefinementList** widget.
 * @param {function} unmountFn Unmount function called when the widget is disposed.
 * @return {function(CustomRefinementListWidgetOptions)} Re-usable widget factory for a custom **RefinementList** widget.
 * @example
 * // custom `renderFn` to render the custom RefinementList widget
 * function renderFn(RefinementListRenderingOptions, isFirstRendering) {
 *   if (isFirstRendering) {
 *     RefinementListRenderingOptions.widgetParams.containerNode
 *       .html('<ul></ul>')
 *   }
 *
 *     RefinementListRenderingOptions.widgetParams.containerNode
 *       .find('li[data-refine-value]')
 *       .each(function() { $(this).off('click'); });
 *
 *   if (RefinementListRenderingOptions.canRefine) {
 *     var list = RefinementListRenderingOptions.items.map(function(item) {
 *       return `
 *         <li data-refine-value="${item.value}">
 *           <input type="checkbox" value="${item.value}" ${item.isRefined ? 'checked' : ''} />
 *           <a href="${RefinementListRenderingOptions.createURL(item.value)}">
 *             ${item.label} (${item.count})
 *           </a>
 *         </li>
 *       `;
 *     });
 *
 *     RefinementListRenderingOptions.widgetParams.containerNode.find('ul').html(list);
 *     RefinementListRenderingOptions.widgetParams.containerNode
 *       .find('li[data-refine-value]')
 *       .each(function() {
 *         $(this).on('click', function(event) {
 *           event.stopPropagation();
 *           event.preventDefault();
 *
 *           RefinementListRenderingOptions.refine($(this).data('refine-value'));
 *         });
 *       });
 *   } else {
 *     RefinementListRenderingOptions.widgetParams.containerNode.find('ul').html('');
 *   }
 * }
 *
 * // connect `renderFn` to RefinementList logic
 * var customRefinementList = instantsearch.connectors.connectRefinementList(renderFn);
 *
 * // mount widget on the page
 * search.addWidgets([
 *   customRefinementList({
 *     containerNode: $('#custom-refinement-list-container'),
 *     attribute: 'categories',
 *     limit: 10,
 *   })
 * ]);
 */
export default function connectRefinementList(renderFn, unmountFn = noop) {
  checkRendering(renderFn, withUsage());

  return (widgetParams = {}) => {
    const {
      attribute,
      operator = 'or',
      limit = 10,
      showMore = false,
      showMoreLimit = 20,
      sortBy = ['isRefined', 'count:desc', 'name:asc'],
      escapeFacetValues = true,
      transformItems = items => items,
    } = widgetParams;

    if (!attribute) {
      throw new Error(withUsage('The `attribute` option is required.'));
    }

    if (!/^(and|or)$/.test(operator)) {
      throw new Error(
        withUsage(
          `The \`operator\` must one of: \`"and"\`, \`"or"\` (got "${operator}").`
        )
      );
    }

    if (showMore === true && showMoreLimit <= limit) {
      throw new Error(
        withUsage('`showMoreLimit` should be greater than `limit`.')
      );
    }

    const formatItems = ({ name: label, ...item }) => ({
      ...item,
      label,
      value: label,
      highlighted: label,
    });

    let lastResultsFromMainSearch = [];
    let hasExhaustiveItems = true;
    let searchForFacetValues;
    let triggerRefine;

    const {
      toggleShowMore,
      setToggleShowMore,
      getIsShowingMore,
      getCurrentLimit,
    } = createShowMore({
      limit,
      showMoreLimit,
    });

    const render = ({
      items,
      state,
      createURL,
      helperSpecializedSearchFacetValues,
      refine,
      isFromSearch,
      isFirstSearch,
      instantSearchInstance,
    }) => {
      // Compute a specific createURL method able to link to any facet value state change
      const _createURL = facetValue =>
        createURL(state.toggleRefinement(attribute, facetValue));

      const isShowingMore = getIsShowingMore();

      // Do not mistake searchForFacetValues and searchFacetValues which is the actual search
      // function
      const searchFacetValues =
        helperSpecializedSearchFacetValues &&
        helperSpecializedSearchFacetValues(
          state,
          createURL,
          helperSpecializedSearchFacetValues,
          refine,
          instantSearchInstance,
          isShowingMore
        );

      const canShowLess =
        isShowingMore && lastResultsFromMainSearch.length > limit;
      const canShowMore = showMore && !isFromSearch && !hasExhaustiveItems;

      const canToggleShowMore = canShowLess || canShowMore;

      renderFn(
        {
          createURL: _createURL,
          items,
          refine,
          searchForItems: searchFacetValues,
          instantSearchInstance,
          isFromSearch,
          canRefine: isFromSearch || items.length > 0,
          widgetParams,
          isShowingMore,
          canToggleShowMore,
          toggleShowMore,
          hasExhaustiveItems,
        },
        isFirstSearch
      );
    };

    /* eslint-disable max-params */
    const createSearchForFacetValues = helper => (
      state,
      createURL,
      helperSpecializedSearchFacetValues,
      toggleRefinement,
      instantSearchInstance
    ) => query => {
      if (query === '' && lastResultsFromMainSearch) {
        // render with previous data from the helper.
        render({
          items: lastResultsFromMainSearch,
          state,
          createURL,
          helperSpecializedSearchFacetValues,
          refine: toggleRefinement,
          isFromSearch: false,
          isFirstSearch: false,
          instantSearchInstance,
        });
      } else {
        const tags = {
          highlightPreTag: escapeFacetValues
            ? TAG_PLACEHOLDER.highlightPreTag
            : TAG_REPLACEMENT.highlightPreTag,
          highlightPostTag: escapeFacetValues
            ? TAG_PLACEHOLDER.highlightPostTag
            : TAG_REPLACEMENT.highlightPostTag,
        };

        helper
          .searchForFacetValues(attribute, query, getCurrentLimit(), tags)
          .then(results => {
            const facetValues = escapeFacetValues
              ? escapeFacets(results.facetHits)
              : results.facetHits;

            const normalizedFacetValues = transformItems(
              facetValues.map(({ value, ...item }) => ({
                ...item,
                value,
                label: value,
              }))
            );

            render({
              items: normalizedFacetValues,
              state,
              createURL,
              helperSpecializedSearchFacetValues,
              refine: toggleRefinement,
              isFromSearch: true,
              isFirstSearch: false,
              instantSearchInstance,
            });
          });
      }
    };
    /* eslint-enable max-params */

    return {
      $$type: 'ais.refinementList',

      init({ helper, createURL, instantSearchInstance }) {
        triggerRefine = facetValue =>
          helper.toggleRefinement(attribute, facetValue).search();

        searchForFacetValues = createSearchForFacetValues(helper);

        render({
          items: [],
          state: helper.state,
          createURL,
          helperSpecializedSearchFacetValues: searchForFacetValues,
          refine: triggerRefine,
          isFromSearch: false,
          isFirstSearch: true,
          instantSearchInstance,
          toggleShowMore,
        });
      },

      render(renderOptions) {
        setToggleShowMore(this.render.bind(this, renderOptions));

        const {
          results,
          state,
          createURL,
          instantSearchInstance,
        } = renderOptions;

        const currentLimit = getCurrentLimit();
        const facetValues = results.getFacetValues(attribute, { sortBy }) || [];
        const items = transformItems(
          facetValues.slice(0, currentLimit).map(formatItems)
        );

        const maxValuesPerFacetConfig = state.maxValuesPerFacet;
        // If the limit is the max number of facet retrieved it is impossible to know
        // if the facets are exhaustive. The only moment we are sure it is exhaustive
        // is when it is strictly under the number requested unless we know that another
        // widget has requested more values (maxValuesPerFacet > currentLimit).
        // Because this is used for making the search of facets unable or not, it is important
        // to be conservative here.
        hasExhaustiveItems =
          maxValuesPerFacetConfig > currentLimit
            ? facetValues.length <= currentLimit
            : facetValues.length < currentLimit;

        lastResultsFromMainSearch = items;

        render({
          items,
          state,
          createURL,
          helperSpecializedSearchFacetValues: searchForFacetValues,
          refine: triggerRefine,
          isFromSearch: false,
          isFirstSearch: false,
          instantSearchInstance,
        });
      },

      dispose({ state }) {
        unmountFn();

        const withoutMaxValuesPerFacet = state.setQueryParameter(
          'maxValuesPerFacet',
          undefined
        );
        if (operator === 'and') {
          return withoutMaxValuesPerFacet.removeFacet(attribute);
        }
        return withoutMaxValuesPerFacet.removeDisjunctiveFacet(attribute);
      },

      getWidgetState(uiState, { searchParameters }) {
        const values =
          operator === 'or'
            ? searchParameters.getDisjunctiveRefinements(attribute)
            : searchParameters.getConjunctiveRefinements(attribute);

        if (!values.length) {
          return uiState;
        }

        return {
          ...uiState,
          refinementList: {
            ...uiState.refinementList,
            [attribute]: values,
          },
        };
      },

      getWidgetSearchParameters(searchParameters, { uiState }) {
        const isDisjunctive = operator === 'or';
        const values =
          uiState.refinementList && uiState.refinementList[attribute];

        const withoutRefinements = searchParameters.clearRefinements(attribute);
        const withFacetConfiguration = isDisjunctive
          ? withoutRefinements.addDisjunctiveFacet(attribute)
          : withoutRefinements.addFacet(attribute);

        const currentMaxValuesPerFacet =
          withFacetConfiguration.maxValuesPerFacet || 0;

        const nextMaxValuesPerFacet = Math.max(
          currentMaxValuesPerFacet,
          showMore ? showMoreLimit : limit
        );

        const withMaxValuesPerFacet = withFacetConfiguration.setQueryParameter(
          'maxValuesPerFacet',
          nextMaxValuesPerFacet
        );

        if (!values) {
          const key = isDisjunctive
            ? 'disjunctiveFacetsRefinements'
            : 'facetsRefinements';

          return withMaxValuesPerFacet.setQueryParameters({
            [key]: {
              ...withMaxValuesPerFacet[key],
              [attribute]: [],
            },
          });
        }

        return values.reduce(
          (parameters, value) =>
            isDisjunctive
              ? parameters.addDisjunctiveFacetRefinement(attribute, value)
              : parameters.addFacetRefinement(attribute, value),
          withMaxValuesPerFacet
        );
      },
    };
  };
}

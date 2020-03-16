import $ from 'jquery';
import _ from 'underscore';

import ItemCollection from '@girder/core/collections/ItemCollection';
import LoadingAnimation from '@girder/core/views/widgets/LoadingAnimation';
import View from '@girder/core/views/View';
import { formatSize } from '@girder/core/misc';

import ItemListTemplate from '@girder/core/templates/widgets/itemList.pug';

/**
 * This widget shows a list of items under a given folder.
 */
var ItemListWidget = View.extend({
    events: {
        'click a.g-item-list-link': function (event) {
            event.preventDefault();
            var cid = $(event.currentTarget).attr('g-item-cid');
            this.trigger('g:itemClicked', this.collection.get(cid), event);
        },
        'click a.g-show-more-items': function () {
            this.collection.fetchNextPage();
        },
        'change .g-list-checkbox': function (event) {
            const target = $(event.currentTarget);
            const cid = target.attr('g-item-cid');
            if (target.prop('checked')) {
                this.checked.push(cid);
            } else {
                const idx = this.checked.indexOf(cid);
                if (idx !== -1) {
                    this.checked.splice(idx, 1);
                }
            }
            this.trigger('g:checkboxesChanged');
        }
    },

    initialize: function (settings) {
        this.checked = [];
        this._checkboxes = settings.checkboxes;
        this._downloadLinks = (
            _.has(settings, 'downloadLinks') ? settings.downloadLinks : true);
        this._viewLinks = (
            _.has(settings, 'viewLinks') ? settings.viewLinks : true);
        this._showSizes = (
            _.has(settings, 'showSizes') ? settings.showSizes : true);
        this.accessLevel = settings.accessLevel;
        this.public = settings.public;
        this._selectedItem = settings.selectedItem;

        new LoadingAnimation({
            el: this.$el,
            parentView: this
        }).render();

        this.collection = new ItemCollection();
        this.collection.append = true; // Append, don't replace pages
        this.collection.filterFunc = settings.itemFilter;

        this.collection.on('g:changed', function () {
            if (this.accessLevel !== undefined) {
                this.collection.each((model) => {
                    model.set('_accessLevel', this.accessLevel);
                });
            }
            this.render();
            this.trigger('g:changed');
        }, this).fetch({ folderId: settings.folderId });
    },

    render: function () {
        this.checked = [];
        if (this._selectedItem) {
            this.observerPosition();
        }

        this.$el.html(ItemListTemplate({
            items: this.collection.toArray(),
            isParentPublic: this.public,
            hasMore: this.collection.hasNextPage(),
            formatSize: formatSize,
            checkboxes: this._checkboxes,
            downloadLinks: this._downloadLinks,
            viewLinks: this._viewLinks,
            showSizes: this._showSizes,
            selectedItemId: (this._selectedItem || {}).id
        }));

        // If we set a selected item in the beginning we will center the selection while loading
        return this;
    },

    /**
     * Insert an item into the collection and re-render it.
     */
    insertItem: function (item) {
        if (this.accessLevel !== undefined) {
            item.set('_accessLevel', this.accessLevel);
        }
        this.collection.add(item);
        this.trigger('g:changed');
        this.render();
    },

    /**
     * Set all item checkboxes to a certain checked state. The event
     * g:checkboxesChanged is triggered once after checking/unchecking everything.
     * @param {bool} checked The checked state.
     */
    checkAll: function (checked) {
        this.$('.g-list-checkbox').prop('checked', checked);

        this.checked = [];
        if (checked) {
            this.collection.each(function (model) {
                this.checked.push(model.cid);
            }, this);
        }

        this.trigger('g:checkboxesChanged');
    },

    /**
     * Select (highlight) an item in the list.
     * @param item An ItemModel instance representing the item to select.
     */
    selectItem: function (item) {
        this.$('li.g-item-list-entry').removeClass('g-selected');
        this.$('a.g-item-list-link[g-item-cid=' + item.cid + ']')
            .parents('li.g-item-list-entry').addClass('g-selected');
    },

    /**
     * Return the currently selected item, or null if there is no selected item.
     */
    getSelectedItem: function () {
        var el = this.$('li.g-item-list-entry.g-selected');
        if (!el.length) {
            return null;
        }
        var cid = $('.g-item-list-link', $(el[0])).attr('g-item-cid');
        return this.collection.get(cid);
    },

    recomputeChecked: function () {
        this.checked = _.map(this.$('.g-list-checkbox:checked'), function (checkbox) {
            return $(checkbox).attr('g-item-cid');
        }, this);
    },

    centerSelected: function (widgetcontainer, selected, breadCrumbHeight = 0) {
        widgetcontainer = $('.g-hierarchy-widget-container');
        selected = $('li.g-item-list-entry.g-selected');
        breadCrumbHeight = (($('.g-hierarchy-breadcrumb-bar') || {}).height() || 0);

        if (widgetcontainer.length > 0 && selected.length > 0) {
            const centerPos = (widgetcontainer.height() / 2.0) + (selected.outerHeight() / 2.0);
            // Performance penalty but needed to get the acurate position of the selected object
            $('.g-hierarchy-widget-container').css({ 'overflow-y': 'visible' });
            const scrollPos = selected.position().top - centerPos;
            $('.g-hierarchy-widget-container').css({ 'overflow-y': 'scroll' });
            if (this.tempScrollPos === undefined) {
                this.tempScrollPos = scrollPos;
            }
            var e = new CustomEvent('scroll', { detail: 9999 });
            widgetcontainer[0].scroll(0, scrollPos);
            widgetcontainer[0].dispatchEvent(e);
        }
    },
    /**
     * This will look at the position of the selected item and update it as images load and
     * the DOM reflows
     */
    observerPosition: function () {
        // Set the default selected height for the selected item
        const target = $('.g-item-list');
        if (window.MutationObserver && target.length > 0) {
            const widgetcontainer = $('.g-hierarchy-widget-container');
            const selected = $('li.g-item-list-entry.g-selected');
            const breadCrumbHeight =  ($('.g-hierarchy-breadcrumb-bar').height() || 0);

            this.observer = new MutationObserver((mutations) => {
                // for every mutation
                _.each(mutations, (mutation) => {
                    // If no nodes are added we can return
                    if (!mutation.addedNodes) {
                        return;
                    }
                    // for every added element
                    _.each(mutation.addedNodes, (node) => {
                        if (node.className && node.className.indexOf('g-item-list') !== -1) {
                            // We want to do a onetime scroll to position if the screen is idle
                            if (window.requestIdleCallback) {
                                // Processing time is 2 seconds, but should be much lower
                                requestIdleCallback(() => {
                                    this.centerSelected(widgetcontainer, selected, breadCrumbHeight);
                                }, { timeout: 2000 });
                            } else {
                                this.centerSelected(widgetcontainer, selected, breadCrumbHeight);
                            }
                        }

                        // For any images added we wait until loaded and rescroll to the selected
                        if (_.isFunction(node.getElementsByTagName)) {
                            const imgs = node.getElementsByTagName('img');
                            for (let i = 0; i < imgs.length; i++) {
                                const onLoadImage = (event) => {
                                    if (this.observer) {
                                        this.centerSelected(widgetcontainer, selected, breadCrumbHeight);
                                    }
                                };
                                // add the event listener to the onload of each image
                                imgs[i].addEventListener('load', onLoadImage);
                            }
                        }
                    });
                });
            });

            // bind mutation observer to a specific element (probably a div somewhere)
            this.observer.observe(target.parent()[0], { childList: true, subtree: true });

            /*
            *  Add in scroll event to kill observer if the user scrolls the area
            *  This doesn't work in FireFox because it handles reflows and scrolls differently than Chrome
            */
            widgetcontainer.bind('scroll.observerscroll', (evt) => {
                if (this.tempScrollPos !== undefined && this.tempScrollPos !== widgetcontainer[0].scrollTop) {
                    this.tempScrollPos = widgetcontainer[0].scrollTop;
                    // If the event detail is not 9999 the scroll is should be a user initiated scroll
                    if (evt.detail !== 9999) {
                        if (this.observer) {
                            widgetcontainer.unbind('scroll.observerscroll');
                            widgetcontainer.unbind('wheel.observerscroll');
                            this.observer.disconnect();
                            this.observer = null;
                        }
                    }
                }
            });
            // Backup function to kill observer if user moves scrollwheel
            widgetcontainer.bind('wheel.selectionobserver', (evt) => {
                if (this.observer) {
                    widgetcontainer.unbind('scroll.observerscroll');
                    widgetcontainer.unbind('wheel.observerscroll');
                    this.observer.disconnect();
                    this.observer = null;
                }
            });
        }
    }
});

export default ItemListWidget;

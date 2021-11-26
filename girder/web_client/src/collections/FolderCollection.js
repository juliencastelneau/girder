import Collection from '@girder/core/collections/Collection';
import FolderModel from '@girder/core/models/FolderModel';

var FolderCollection = Collection.extend({
    resourceName: 'folder',
    model: FolderModel,

    pageLimit: 10
});

export default FolderCollection;

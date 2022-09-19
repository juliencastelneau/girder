import $ from 'jquery';
import _, { reject } from 'underscore';

import FileModel from '@girder/core/models/FileModel';
import View from '@girder/core/views/View';
import { formatSize } from '@girder/core/misc';
import { handleClose, handleOpen } from '@girder/core/dialog';

import UploadWidgetTemplate from '@girder/core/templates/widgets/uploadWidget.pug';
import UploadWidgetNonModalTemplate from '@girder/core/templates/widgets/uploadWidgetNonModal.pug';

import '@girder/core/stylesheets/widgets/uploadWidget.styl';

import '@girder/core/utilities/jquery/girderEnable';
import '@girder/core/utilities/jquery/girderModal';
import dcmjs from 'dcmjs';
import JSZip from 'jszip';

const {
    DicomMetaDictionary,
    DicomDict,
    DicomMessage,
    ReadBufferStream
} = dcmjs.data;
const { cleanTags } = dcmjs.anonymizer;

/**
 * This widget is used to upload files to a folder. Pass a folder model
 * to its constructor as the parent folder that will be uploaded into.
 * The events:
 *   itemComplete: Triggered each time an individual item is finished uploading.
 *   finished: Triggered when the entire set of items is uploaded.
 */
var UploadWidget = View.extend({
    events: {
        'submit #g-upload-form': function (e) {
            e.preventDefault();
            this.startUpload();
        },
        'click .g-resume-upload': function () {
            this.$('.g-upload-error-message').html('');
            this.currentFile.resumeUpload();
        },
        'click .g-restart-upload': function () {
            this.$('.g-upload-error-message').html('');
            this.uploadNextFile();
        },
        'change #g-files': function () {
            var files = this.$('#g-files')[0].files;

            if (files.length) {
                this.files = files;
                this.filesChanged();
            }
        },
        'click .g-drop-zone': function () {
            this.$('#g-files').trigger('click');
        },
        'dragenter .g-drop-zone': function (e) {
            e.stopPropagation();
            e.preventDefault();
            e.originalEvent.dataTransfer.dropEffect = 'copy';
            this.$('.g-drop-zone')
                .addClass('g-dropzone-show')
                .html('<i class="icon-bullseye"/> Drop files here');
        },
        'dragleave .g-drop-zone': function (e) {
            e.stopPropagation();
            e.preventDefault();
            this.$('.g-drop-zone')
                .removeClass('g-dropzone-show')
                .html('<i class="icon-docs"/> Browse or drop files');
        },
        'dragover .g-drop-zone': function (e) {
            var dataTransfer = e.originalEvent.dataTransfer;
            if (!dataTransfer) {
                return;
            }
            // The following two lines enable drag and drop from the chrome download bar
            var allowed = dataTransfer.effectAllowed;
            dataTransfer.dropEffect = (allowed === 'move' || allowed === 'linkMove') ? 'move' : 'copy';

            e.preventDefault();
        },
        'drop .g-drop-zone': 'filesDropped'
    },
    /**
     * This widget has several configuration options to control its view and
     * behavior. The following keys can be passed in the settings object:
     *
     * @param [parent] If the parent object is known when instantiating this
     * upload widget, pass the object here.
     * @param [parentType=folder] If the parent type is known when instantiating this
     * upload widget, pass the object here. Otherwise set noParent: true and
     * set it later, prior to starting the upload.
     * @param [noParent=false] If the parent object being uploaded into is not known
     * at the time of widget instantiation, pass noParent: true. Callers must
     * ensure that the parent is set by the time uploadNextFile() actually gets
     * called.
     * @param [title="Upload files"] Title for the widget. This is highly recommended
     * when rendering as a modal dialog. To disable rendering of the title, simply
     * pass a falsy object.
     * @param [modal=true] This widget normally renders as a modal dialog. Pass
     * modal: false to disable the modal behavior and simply render underneath a
     * parent element.
     * @param [overrideStart=false] Some callers will want to hook into the pressing
     * of the start upload button and add their own logic prior to actually sending
     * the files. To do so, set overrideStart: true and bind to the "g:uploadStarted"
     * event of this widget. The caller is then responsible for calling "uploadNextFile()"
     * on the widget when they have completed their actions and are ready to actually
     * send the files.
     * @param [multiFile=true] By default, this widget allows selection of multiple
     * files. Set this to false to only allow a single file to be chosen.
     * @param [otherParams={}] An object containing other parameters to pass into the
     * upload initialization endpoint, or a function that returns such an object. If a
     * function, will be called when the upload is started.
     *
     * Other events:
     *   - "g:filesChanged": This is triggered any time the user changes the
     *     file selection, either by dropping or browsing and selecting new files.
     *     Handlers will receive a single argument, which is the list of chosen files.
     *   - "g:uploadFinished": When all files have been successfully uploaded,
     *     this event is fired.
     */
    initialize: function (settings) {
        if (settings.noParent) {
            this.parent = null;
            this.parentType = null;
        } else {
            this.parent = settings.parent || settings.folder;
            this.parentType = settings.parentType || 'folder';
        }
        this.files = [];
        this.totalSize = 0;
        this.title = _.has(settings, 'title') ? settings.title : 'Upload files';
        this.modal = _.has(settings, 'modal') ? settings.modal : true;
        this.multiFile = _.has(settings, 'multiFile') ? settings.multiFile : this.parentType !== 'file';
        this.overrideStart = settings.overrideStart || false;
        this.otherParams = settings.otherParams || {};

        this._browseText = this.multiFile ? 'Browse or drop files here' : 'Browse or drop a file here';
        this._noneSelectedText = this.multiFile ? 'No files selected' : 'No file selected';
        
        if (typeof this.parent != "undefined" &&
            typeof this.parent.attributes != "undefined" &&
            this.parent.attributes.name === "DICOM") {
            if (typeof this.parentView != "undefined" &&
                typeof this.parentView.parentView.collection != "undefined" &&
                typeof this.parentView.parentView.collection.attributes != "undefined" &&
                this.parentView.parentView.collection.attributes.name === "MUSIC TV HL") {
                console.log("HERE WE GO");
                console.log(this.parent.attributes.name);
                console.log(this.parentView.parentView.collection.attributes.name);
            }
        }
        this.on('g:uploadStarted', function () {
            this._uploadStarted();
        });

    },

    render: function () {
        var templateParams = {
            parent: this.parent,
            parentType: this.parentType,
            title: this.title,
            multiFile: this.multiFile,
            browseText: this._browseText,
            noneSelectedText: this._noneSelectedText
        };

        if (this.modal) {
            this.$el.html(UploadWidgetTemplate(templateParams));

            var dialogid;
            if (this.parentType === 'file') {
                dialogid = this.parent.get('_id');
            }

            this.$el.girderModal(this).on('hidden.bs.modal', () => {
                /* If we are showing the resume option, we have a partial upload
                 * that should be deleted, since the user has no way to get back
                 * to it. */
                if ($('.g-resume-upload').length && this.currentFile) {
                    this.currentFile.abortUpload();
                }
                handleClose('upload', undefined, dialogid);
            });

            handleOpen('upload', undefined, dialogid);
        } else {
            this.$el.html(UploadWidgetNonModalTemplate(templateParams));
        }
        return this;
    },

    filesDropped: function (e) {
        e.stopPropagation();
        e.preventDefault();

        this.$('.g-drop-zone')
            .removeClass('g-dropzone-show')
            .html(`<i class="icon-docs"/> ${this._browseText}`);

        var dataTransfer = e.originalEvent.dataTransfer;

        // Require all dropped items to be files
        if (!_.every(dataTransfer.items, (item) => this._isFile(item))) {
            this.$('.g-upload-error-message').html('Only files may be uploaded.');
            return;
        }
        this.files = dataTransfer.files;

        if (!this.multiFile && this.files.length > 1) {
            // If in single-file mode and the user drops multiple files,
            // we just take the first one.
            this.files = [this.files[0]];
        }

        this.filesChanged();
    },

    filesChanged: function () {
        if (this.files.length === 0) {
            this.$('.g-overall-progress-message').text(this._noneSelectedText);
            this.setUploadEnabled(false);
        } else {
            this.totalSize = 0;
            _.each(this.files, function (file) {
                this.totalSize += file.size;
            }, this);

            var msg;

            if (this.files.length > 1) {
                msg = 'Selected ' + this.files.length + ' files';
            } else {
                msg = 'Selected <b>' + this.files[0].name + '</b>';
            }
            this.$('.g-overall-progress-message').html('<i class="icon-ok"/> ' +
                msg + '  (' + formatSize(this.totalSize) +
                ') -- Press start button');
            this.setUploadEnabled(true);
            this.$('.g-progress-overall,.g-progress-current').addClass('hide');
            this.$('.g-current-progress-message').empty();
            this.$('.g-upload-error-message').empty();
        }

        this.trigger('g:filesChanged', this.files);
    },

    startUpload: function () {
        this.setUploadEnabled(false);
        this.$('.g-drop-zone').addClass('hide');
        this.$('.g-progress-overall').removeClass('hide');
        this.$('.g-upload-error-message').empty();

        if (this.multiFile) {
            this.$('.g-progress-current').removeClass('hide');
        }

        this.currentIndex = 0;
        this.overallProgress = 0;
        this.trigger('g:uploadStarted');

        if (!this.overrideStart) {
            this.uploadNextFile();
        }
    },

    /**
     * Enable or disable the start upload button.
     *
     * @param state {bool} Truthy for enabled, falsy for disabled.
     */
    setUploadEnabled: function (state) {
        this.$('.g-start-upload').girderEnable(state);
    },
    
    read_file: function (file) {
        return new Promise( resolve  => {
            var fr = new FileReader();
            fr.onload = function (e) {
                let arrayBuffer = e.target.result;
                try {
                    
                    var dicomDict = DicomMessage.readFile(arrayBuffer);
                    var tagsToReplace = {};
                    var tagNamesToEmpty = ["PatientName", "PatientBirthDate"];
 
                    cleanTags(dicomDict.dict, tagsToReplace, tagNamesToEmpty);

                    var blob = new Blob([dicomDict.write()], { type: "application/octet-stream" });                    
                    var name = file.name;
                    var modified_file = new File([blob], name);
                    resolve(modified_file);
                } catch (TypeError) {
                    resolve(file);
                } 

            };
            fr.readAsArrayBuffer(file);
        }, reason => {
            reject(reason)
        });
    },
    
    uncompressArchiveToAnonymize: function (file) {
        let promises = [];
        var jsZip = require('jszip');
        return jsZip.loadAsync(file).then(function (zip) {
            for (var filename in zip.files) {
                if (zip.files[filename].dir) {
                    delete zip.files[filename]
                }
            }

            var anonymizeZipFiles = function (zip, filename) {
                return new Promise((resolve, reject) => {
                    var cb = function updateCallback(metadata) {
                        console.log(metadata)
                        this.$('.g-progress-current>.progress-bar').css('width',
                            metadata.percent.toFixed(2) + '%');
                        this.$('.g-current-progress-message').html(
                            '<i class="icon-doc-text"/> Anonymization : <b>' +
                            metadata.percent.toFixed(2) + ' % </b> ');    
                    }.bind(this);
    
                    zip.files[filename].async('ArrayBuffer', cb ).then(function (fileData) {
                        var name = filename.replace(/^.*[\\\/]/, '');
                        try {
                            var dicomDict = DicomMessage.readFile(fileData);
                            var tagsToReplace = {};
                            var tagNamesToEmpty = ["PatientName", "PatientBirthDate"];
                            
                            cleanTags(dicomDict.dict, tagsToReplace, tagNamesToEmpty);

                            resolve([name, dicomDict.write()]);
                        } catch (TypeError) {
                            resolve([name, fileData]);
                        }
                    })
                })
            }.bind(this);
            
            Object.keys(zip.files).forEach(function (filename) {
                promises.push(anonymizeZipFiles(zip, filename));
            });
 
            return Promise.all(promises);

        }.bind(this), function (reject) {
            var html = reject + ' <a class="g-resume-upload"></a>';
            this.$('.g-upload-error-message').html(html);
        }.bind(this))

    },

    manage_zip: function (file) {
        let promises = [];
        var name = file.name;
        promises.push(this.uncompressArchiveToAnonymize(file))

        return Promise.all(promises)
            .then(results => {
                try {
                    var filesToCompress = results[0];
                    var zip = new JSZip();
                    filesToCompress.forEach(function (info) {
                        zip.file(info[0], info[1]);
                    })
                    var cb = function updateCallback(metadata) {
                        this.$('.g-progress-current>.progress-bar').css('width',
                            metadata.percent.toFixed(2) + '%');
                        if (metadata.currentFile) {
                            this.$('.g-current-progress-message').html(
                                '<i class="icon-doc-text"/> Compression <b>' + metadata.currentFile + '</b> ' +
                                metadata.percent.toFixed(2) + ' %'
                            );
                        }
                    }.bind(this);
                    
                    return zip.generateAsync({ type: "blob", mimeType: "application/zip" }, cb).then(function (blob) {
                        return new File([blob], name, { type: "application/zip" });;
                    }, function (reject) {
                        var html = reject + ' <a class="g-resume-upload"></a>';
                        this.$('.g-upload-error-message').html(html);                    
                    });    
                }
                catch (Error) {
                    var html = Error + ' <a class="g-resume-upload"></a>';
                    this.$('.g-upload-error-message').html(html);                    
                }
            }, reject => {
                var html = reject + ' <a class="g-resume-upload"></a>';
                this.$('.g-upload-error-message').html(html);
            });
    },

    _uploadStarted: function () {

        let promises = []; // collect all promises
        for (var file of this.files) {   
            if (file.type === "application/zip") {
                promises.push(this.manage_zip(file)); 
            }
            else {
                promises.push(this.read_file(file));        
            }
        }
        Promise.all(promises) // wait for the resolutions
            .then(results => {
                this.files = results;
                this.uploadNextFile();
            }, reject => {
                var html = reject + ' <a class="g-resume-upload"></a>';
                this.$('.g-upload-error-message').html(html);
            })
  },
    /**
     * Initializes the upload of a file by requesting the upload token
     * from the server. If successful, this will call _uploadChunk to send the
     * actual bytes from the file if it is of non-zero length.
     */
    uploadNextFile: function () {
        if (this.currentIndex >= this.files.length) {
            // All files have finished
            if (this.modal) {
                this.$el.modal('hide');
            }
            this.trigger('g:uploadFinished', {
                files: this.files,
                totalSize: this.totalSize
            });
            return;
        }

        this.currentFile = this.parentType === 'file' ? this.parent : new FileModel();

        this.currentFile.on('g:upload.complete', function () {
            this.files[this.currentIndex].id = this.currentFile.id;
            this.currentIndex += 1;
            this.uploadNextFile();
        }, this).on('g:upload.chunkSent', function (info) {
            this.overallProgress += info.bytes;
        }, this).on('g:upload.progress', function (info) {
            var currentProgress = info.startByte + info.loaded;

            this.$('.g-progress-current>.progress-bar').css('width',
                Math.ceil(100 * currentProgress / info.total) + '%');
            this.$('.g-progress-overall>.progress-bar').css('width',
                Math.ceil(100 * (this.overallProgress + info.loaded) /
                          this.totalSize) + '%');
            this.$('.g-current-progress-message').html(
                '<i class="icon-doc-text"/>' + (this.currentIndex + 1) + ' of ' +
                    this.files.length + ' - <b>' + info.file.name + '</b>: ' +
                    formatSize(currentProgress) + ' / ' +
                    formatSize(info.total)
            );
            this.$('.g-overall-progress-message').html('Overall progress: ' +
                formatSize(this.overallProgress + info.loaded) + ' / ' +
                formatSize(this.totalSize));
        }, this).on('g:upload.error', function (info) {
            var html = info.message + ' <a class="g-resume-upload">' +
                'Click to resume upload</a>';
            $('.g-upload-error-message').html(html);
        }, this).on('g:upload.errorStarting', function (info) {
            var html = info.message + ' <a class="g-restart-upload">' +
                'Click to restart upload</a>';
            $('.g-upload-error-message').html(html);
        }, this);

        if (this.parentType === 'file') {
            this.currentFile.updateContents(this.files[this.currentIndex]);
        } else {
            var otherParams = this.otherParams;
            if (_.isFunction(this.otherParams)) {
                otherParams = this.otherParams(this);
            }
            this.currentFile.upload(this.parent, this.files[this.currentIndex], null, otherParams);
        }
    },

    /**
     * Check whether a DataTransferItem from a drag and drop operation
     * represents a file, as opposed to a directory, URI, string, or other
     * entity.
     * @param {DataTransferItem} item - The item from a drag and drop operation.
     * @returns {boolean} True if item represents a file.
     */
    _isFile: function (item) {
        var getAsEntry = item.getAsEntry;
        if (!_.isFunction(getAsEntry)) {
            getAsEntry = item.webkitGetAsEntry;
        }
        if (!_.isFunction(getAsEntry)) {
            // Unsupported; assume item is file
            return true;
        }

        var entry = getAsEntry.call(item);
        return entry && entry.isFile;
    }
});

export default UploadWidget;

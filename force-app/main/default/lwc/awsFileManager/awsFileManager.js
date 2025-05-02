import { LightningElement, track, wire } from 'lwc';
import { loadScript } from 'lightning/platformResourceLoader';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import awsSdk from '@salesforce/resourceUrl/AWS_SDK_JS';
import fetchAWSConfig from '@salesforce/apex/S3FileHandler.fetchAWSConfig';
import createFileMetadata from '@salesforce/apex/S3FileHandler.createFileMetadata';
import getFileMetadata from '@salesforce/apex/S3FileHandler.getFileMetadata';
import deleteFileMetadata from '@salesforce/apex/S3FileHandler.deleteFileMetadata';

export default class AwsFileManager extends LightningElement {
    @track fileList = [];
    @track breadcrumb = ['root'];
    @track showPreviewModal = false;
    @track previewUrl = '';
    @track selectedFile = null;
    @track isVideoFile = false;
    @track isImageFile = false;
    @track isPdfFile = false;
    @track videoType = '';
    isSdkLoaded = false;
    awsConfig = null;
    selectedFiles = [];
    isLoading = false;
    refreshTrigger = 0; // Used to trigger reactive updates

    connectedCallback() {
        this.fetchAWSConfiguration();
        window.addEventListener('awsfilemanagerrefresh', this.handleRefresh.bind(this));
    }

    disconnectedCallback() {
        window.removeEventListener('awsfilemanagerrefresh', this.handleRefresh);
    }

    handleRefresh() {
        this.forceRefresh();
    }

    async forceRefresh() {
        this.isLoading = true;
        try {
            // Clear current data
            this.fileList = [];
            // Force a re-render
            await Promise.resolve();
            // Fetch fresh data
            await this.fetchFileMetadata();
            // Increment refresh trigger for wire methods
            this.refreshTrigger++;
        } catch (error) {
            console.error('Refresh error:', error);
            this.showToast('Error', 'Failed to refresh data', 'error');
        } finally {
            this.isLoading = false;
        }
    }

    fetchAWSConfiguration() {
        this.isLoading = true;
        this.showToast('Loading', 'Fetching AWS configuration...', 'info');
       
        fetchAWSConfig()
            .then((config) => {
                this.awsConfig = {
                    region: config.Region__c,
                    credentials: {
                        accessKeyId: config.Access_Key__c,
                        secretAccessKey: config.Secret_Key__c
                    }
                };
                loadScript(this, awsSdk)
                    .then(() => {
                        this.isSdkLoaded = true;
                        this.fetchFileMetadata();
                    })
                    .catch(error => {
                        console.error('AWS SDK Load Error:', error);
                        this.showToast('Error', 'Failed to load AWS SDK', 'error');
                    });
            })
            .catch((error) => {
                console.error('Error fetching AWS Config:', error);
                this.showToast('Error', 'Failed to fetch AWS configuration', 'error');
            })
            .finally(() => {
                this.isLoading = false;
            });
    }

    @wire(getFileMetadata, { refreshTrigger: '$refreshTrigger' })
    wiredFiles({ error, data }) {
        if (data) {
            this.processFileData(data);
        } else if (error) {
            console.error('Error fetching file metadata:', error);
            this.showToast('Error', 'Failed to load files and folders', 'error');
        }
    }

    processFileData(data) {
        const currentPath = this.breadcrumb.join('/') + '/';
        this.fileList = data
            .filter(record => {
                if (record.File_Key__c.endsWith('/')) {
                    return record.File_Key__c === currentPath + record.Name + '/';
                } else {
                    const parentPath = record.File_Key__c.substring(0, record.File_Key__c.lastIndexOf('/') + 1);
                    return parentPath === currentPath;
                }
            })
            .map(record => ({
                Key: record.File_Key__c,
                name: record.Name,
                type: record.File_Key__c.endsWith('/') ? 'folder' : 'file',
                icon: record.File_Key__c.endsWith('/') ? 'utility:folder' : 'utility:file',
                selected: false,
                recordId: record.Id,
                isFolder: record.File_Key__c.endsWith('/'),
                extension: record.File_Key__c.endsWith('/') ? '' : record.File_Key__c.split('.').pop().toLowerCase()
            }));
    }

    fetchFileMetadata() {
        return new Promise((resolve, reject) => {
            this.isLoading = true;
            getFileMetadata()
                .then(data => {
                    this.processFileData(data);
                    resolve(data);
                })
                .catch(error => {
                    console.error('Error fetching file metadata:', error);
                    this.showToast('Error', 'Failed to load files and folders', 'error');
                    reject(error);
                })
                .finally(() => {
                    this.isLoading = false;
                });
        });
    }

    handleFileSelection(event) {
        this.selectedFiles = Array.from(event.target.files);
    }

    async checkForDuplicateFiles(filesToCheck) {
        const existingFiles = await getFileMetadata();
        
        const duplicates = [];
        
        filesToCheck.forEach(file => {
            const fileNameOnly = file.name;
            const exists = existingFiles.some(
                record => record.Name === fileNameOnly && 
                         record.File_Key__c.endsWith(fileNameOnly)
            );
            if (exists) {
                duplicates.push(file.name);
            }
        });
        
        return duplicates;
    }

    async uploadFiles() {
        if (!this.isSdkLoaded) {
            console.error('AWS SDK is not loaded');
            return;
        }
       
        if (this.selectedFiles.length === 0) {
            this.showToast('Info', 'Please select files to upload', 'info');
            return;
        }

        // Check for duplicates
        const duplicates = await this.checkForDuplicateFiles(this.selectedFiles);
        if (duplicates.length > 0) {
            this.showToast(
                'Error', 
                `Cannot upload: These files already exist - ${duplicates.join(', ')}`, 
                'error'
            );
            return;
        }

        this.isLoading = true;
        this.showToast('Info', 'Uploading files...', 'info');
       
        const s3 = new AWS.S3(this.awsConfig);
        const folderPath = this.breadcrumb.join('/') + '/';
       
        try {
            const uploadPromises = this.selectedFiles.map(file => {
                const params = {
                    Bucket: 'uploadfile2-s3',
                    Key: folderPath + file.name,
                    Body: file
                };
               
                return s3.upload(params).promise()
                    .then(data => {
                        return createFileMetadata({
                            fileName: file.name,
                            fileKey: folderPath + file.name,
                            bucketName: 'uploadfile2-s3',
                            region: 'us-east-1'
                        });
                    });
            });

            await Promise.all(uploadPromises);
            this.showToast('Success', 'Files uploaded successfully', 'success');
            this.template.querySelector('.file-input').value = '';
           
            // Trigger refresh
            await this.forceRefresh();
            this.dispatchRefreshEvent();
           
            this.selectedFiles = [];
        } catch (err) {
            console.error('Upload Error:', err);
            this.showToast('Error', 'Error uploading files', 'error');
        } finally {
            this.isLoading = false;
        }
    }

    handleSelectFile(event) {
        const fileKey = event.target.dataset.key;
        const file = this.fileList.find(f => f.Key === fileKey);
        file.selected = event.target.checked;
       
        if (file.selected) {
            this.selectedFiles.push(file);
        } else {
            this.selectedFiles = this.selectedFiles.filter(f => f.Key !== fileKey);
        }
       
        this.fileList = [...this.fileList];
    }

    handleFileClick(event) {
        const fileKey = event.currentTarget.dataset.key;
        const file = this.fileList.find(file => file.Key === fileKey);
        if (file.isFolder) {
            this.navigateToFolder(fileKey);
        }
    }

    navigateToFolder(event) {
        const folderKey = typeof event === 'string' ? event : event.currentTarget.dataset.key;
        const folderName = folderKey.split('/').slice(-2, -1)[0];
        this.breadcrumb.push(folderName);
        this.fetchFileMetadata();
    }

    navigateBack() {
        if (this.breadcrumb.length > 1) {
            this.breadcrumb.pop();
            this.fetchFileMetadata();
        }
    }

    async handleSingleDelete(event) {
        const fileKey = event.currentTarget.dataset.key;
        const confirmed = confirm('Are you sure you want to delete this item?');
        if (confirmed) {
            await this.deleteFile(fileKey);
        }
    }

    async handleDelete() {
        if (this.selectedFiles.length > 0) {
            const confirmed = confirm(`Are you sure you want to delete ${this.selectedFiles.length} selected items?`);
            if (confirmed) {
                for (const file of this.selectedFiles) {
                    await this.deleteFile(file.Key);
                }
                this.clearSelection();
            }
        } else {
            this.showToast('Error', 'No files selected', 'error');
        }
    }

    async deleteFile(fileKey) {
        this.isLoading = true;
        this.showToast('Info', 'Deleting...', 'info');
        
        const s3 = new AWS.S3(this.awsConfig);
        
        try {
            // Check if this is a folder
            if (fileKey.endsWith('/')) {
                // First list and delete all contents
                const listParams = {
                    Bucket: 'uploadfile2-s3',
                    Prefix: fileKey
                };
                
                const listedObjects = await s3.listObjectsV2(listParams).promise();
                
                if (listedObjects.Contents.length > 1) {
                    const deleteParams = {
                        Bucket: 'uploadfile2-s3',
                        Delete: {
                            Objects: listedObjects.Contents.map(content => ({ Key: content.Key })),
                            Quiet: false
                        }
                    };
                    
                    await s3.deleteObjects(deleteParams).promise();
                }
            }
            
            // Delete the folder/file itself
            await s3.deleteObject({
                Bucket: 'uploadfile2-s3',
                Key: fileKey
            }).promise();
            
            // Delete metadata
            await deleteFileMetadata({ fileKey });
            
            this.showToast('Success', 'Deleted successfully', 'success');
            
            // Trigger refresh
            await this.forceRefresh();
            this.dispatchRefreshEvent();
            
        } catch (err) {
            console.error('Delete Error:', err);
            this.showToast('Error', 'Error during deletion', 'error');
        } finally {
            this.isLoading = false;
        }
    }

    dispatchRefreshEvent() {
        const refreshEvent = new CustomEvent('awsfilemanagerrefresh');
        window.dispatchEvent(refreshEvent);
    }

    handlePreview(event) {
        const fileKey = event.currentTarget.dataset.key;
        this.previewFile(fileKey);
    }

    previewFile(fileKey) {
        this.isLoading = true;
        const s3 = new AWS.S3(this.awsConfig);
        const params = {
            Bucket: 'uploadfile2-s3',
            Key: fileKey,
            Expires: 3600 // 1 hour expiration
        };

        s3.getSignedUrl('getObject', params, (err, url) => {
            this.isLoading = false;
            if (err) {
                console.error('Error generating preview URL:', err);
                this.showToast('Error', 'Error generating preview URL', 'error');
                return;
            }

            this.previewUrl = url;
            this.selectedFile = this.fileList.find(f => f.Key === fileKey);
            
            // Determine file type for proper preview
            const extension = fileKey.split('.').pop().toLowerCase();
            this.isImageFile = ['jpg', 'jpeg', 'png', 'gif'].includes(extension);
            this.isVideoFile = ['mp4', 'webm', 'ogg'].includes(extension);
            this.isPdfFile = extension === 'pdf';
            
            if (this.isVideoFile) {
                this.videoType = `video/${extension}`;
            }
            
            this.showPreviewModal = true;
        });
    }

    handleDownload() {
        if (this.selectedFiles.length > 0) {
            this.isLoading = true;
            this.showToast('Info', 'Preparing downloads...', 'info');
            this.downloadFilesSequentially(0);
        } else {
            this.showToast('Error', 'No files selected', 'error');
        }
    }
    
    downloadFilesSequentially(index) {
        if (index >= this.selectedFiles.length) {
            this.isLoading = false;
            return;
        }
    
        const fileKey = this.selectedFiles[index].Key;
        const s3 = new AWS.S3(this.awsConfig);
        const params = {
            Bucket: 'uploadfile2-s3',
            Key: fileKey,
            Expires: 60
        };
    
        s3.getSignedUrl('getObject', params, (err, url) => {
            if (err) {
                console.error('Error generating pre-signed URL:', err);
                this.showToast('Error', `Error generating download URL for ${this.selectedFiles[index].name}`, 'error');
                this.downloadFilesSequentially(index + 1);
            } else {
                setTimeout(() => {
                    const downloadWindow = window.open(url, '_blank');
                    if (!downloadWindow || downloadWindow.closed || typeof downloadWindow.closed == 'undefined') {
                        this.showToast('Warning', 'Popup blocked. Please allow popups for multiple downloads.', 'warning');
                    }
                    
                    setTimeout(() => {
                        this.downloadFilesSequentially(index + 1);
                    }, 500);
                }, index === 0 ? 0 : 500);
            }
        });
    }

    closePreviewModal() {
        this.showPreviewModal = false;
        this.previewUrl = '';
        this.isVideoFile = false;
        this.isImageFile = false;
        this.isPdfFile = false;
    }

    createFolder() {
        const folderName = prompt('Enter folder name:');
        if (folderName) {
            this.isLoading = true;
            this.showToast('Info', 'Creating folder...', 'info');
           
            const s3 = new AWS.S3(this.awsConfig);
            const folderPath = this.breadcrumb.join('/') + '/' + folderName + '/';
            const params = {
                Bucket: 'uploadfile2-s3',
                Key: folderPath,
                Body: ''
            };
           
            s3.putObject(params, (err, data) => {
                if (err) {
                    console.error('Error creating folder:', err);
                    this.showToast('Error', 'Error creating folder', 'error');
                    this.isLoading = false;
                } else {
                    createFileMetadata({
                        fileName: folderName,
                        fileKey: folderPath,
                        bucketName: 'uploadfile2-s3',
                        region: 'us-east-1'
                    }).then(() => {
                        this.showToast('Success', 'Folder created successfully', 'success');
                        this.forceRefresh();
                        this.dispatchRefreshEvent();
                    }).catch(error => {
                        console.error('Error creating folder metadata:', error);
                        this.showToast('Error', 'Error creating folder metadata', 'error');
                        this.isLoading = false;
                    });
                }
            });
        }
    }

    clearSelection() {
        this.fileList = this.fileList.map(file => {
            return {...file, selected: false};
        });
        this.selectedFiles = [];
    }

    showToast(title, message, variant) {
        const event = new ShowToastEvent({
            title: title,
            message: message,
            variant: variant
        });
        this.dispatchEvent(event);
    }
}
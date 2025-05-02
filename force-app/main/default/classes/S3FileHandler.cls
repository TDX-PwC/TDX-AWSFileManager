public with sharing class S3FileHandler {
    // Fetch AWS configuration from custom metadata
    @AuraEnabled(cacheable=true)
    public static AWS_S3_Configuration__mdt fetchAWSConfig() {
        return [
            SELECT Bucket_Name__c, Access_Key__c, Secret_Key__c, Region__c
            FROM AWS_S3_Configuration__mdt
            LIMIT 1
        ];
    }

    // Create file metadata record - Updated for global duplicate check
    @AuraEnabled
    public static void createFileMetadata(String fileName, String fileKey, String bucketName, String region) {
        // Check if file already exists anywhere in the system
        String fileNameOnly = fileKey.substringAfterLast('/');
        List<File_Metadata__c> existingFiles = [
            SELECT Id FROM File_Metadata__c 
            WHERE Name = :fileNameOnly
            AND File_Key__c LIKE :('%' + fileNameOnly)
            LIMIT 1
        ];
        
        if (!existingFiles.isEmpty()) {
            throw new AuraHandledException('A file with this name already exists in the system');
        }
        
        File_Metadata__c fileMetadata = new File_Metadata__c();
        fileMetadata.Name = fileName;
        fileMetadata.File_Key__c = fileKey;
        fileMetadata.Bucket_Name__c = bucketName;
        fileMetadata.Region__c = region;
        fileMetadata.Date_Time__c = DateTime.now();
        insert fileMetadata;
    }

    // Retrieve all file metadata records
    @AuraEnabled(cacheable=true)
    public static List<File_Metadata__c> getFileMetadata() {
        return [
            SELECT Id, Name, File_Key__c, Bucket_Name__c, Region__c, Date_Time__c
            FROM File_Metadata__c
            ORDER BY Date_Time__c DESC
        ];
    }
    
    @AuraEnabled(cacheable=true)
    public static Boolean fileExists(String fileKey) {
        String fileNameOnly = fileKey.substringAfterLast('/');
        List<File_Metadata__c> existingFiles = [
            SELECT Id FROM File_Metadata__c 
            WHERE Name = :fileNameOnly
            LIMIT 1
        ];
        return !existingFiles.isEmpty();
    }

    // Delete a file metadata record by file key (handles folders with contents)
    @AuraEnabled
    public static void deleteFileMetadata(String fileKey) {
        if (fileKey.endsWith('/')) {
            // Delete all files with this prefix (folder contents)
            List<File_Metadata__c> filesToDelete = [
                SELECT Id FROM File_Metadata__c 
                WHERE File_Key__c LIKE :(fileKey + '%')
            ];
            if (!filesToDelete.isEmpty()) {
                delete filesToDelete;
            }
        } else {
            // Single file deletion
            List<File_Metadata__c> filesToDelete = [
                SELECT Id FROM File_Metadata__c 
                WHERE File_Key__c = :fileKey
            ];
            if (!filesToDelete.isEmpty()) {
                delete filesToDelete;
            }
        }
    }
}
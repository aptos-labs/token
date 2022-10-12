interface AssetUploader {
    provider: string;

    // Upload content to off-chain storage and return a link
    uploadFile(filePath: string): string;

    uploadContent(content: string): string;

    // Upload content to off-chain straoge and return the content hash
    calculateContentHash(content: string): string;
}
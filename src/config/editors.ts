import { loadConfig } from './config';

export interface EditorConfig {
    id: string;
    name: string;
    fileTypes: string[];
    icon: string;
    isDesktopApp: boolean;
    launchUrl?: string;
    apiKey?: string;
    webdavEnabled?: boolean;
}

export const defaultEditors: EditorConfig[] = [
    {
        id: 'pdfelement',
        name: 'Wondershare PDFelement',
        fileTypes: ['pdf'],
        icon: 'file-pdf',
        isDesktopApp: true,
        launchUrl: 'pdfelement://open?file={FILE_PATH}'
    },
    {
        id: 'msword',
        name: 'Microsoft Word',
        fileTypes: ['doc', 'docx'],
        icon: 'file-word',
        isDesktopApp: true,
        launchUrl: 'ms-word:ofe|u|{FILE_URL}'
    },
    {
        id: 'msexcel',
        name: 'Microsoft Excel',
        fileTypes: ['xls', 'xlsx'],
        icon: 'file-excel',
        isDesktopApp: true,
        launchUrl: 'ms-excel:ofe|u|{FILE_URL}'
    },
    {
        id: 'googledocs',
        name: 'Google Docs',
        fileTypes: ['doc', 'docx', 'pdf', 'txt'],
        icon: 'google',
        isDesktopApp: false,
        launchUrl: 'https://docs.google.com/gview?url={FILE_URL}&embedded=true'
    },
    {
        id: 'libreoffice',
        name: 'LibreOffice',
        fileTypes: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp'],
        icon: 'file-earmark-text',
        isDesktopApp: true
    }
];

/**
 * Get all configured external editors
 */
export function getConfiguredEditors(): EditorConfig[] {
    const config = loadConfig();

    // Merge default editors with custom editors from config
    const customEditors = config.editors?.customEditors || [];
    const editors = [...defaultEditors, ...customEditors];

    // Filter out disabled editors
    const disabledEditors = config.editors?.disabledEditors || [];
    return editors.filter(editor => !disabledEditors.includes(editor.id));
}

/**
 * Get suitable editors for a specific file type
 */
export function getEditorsForFileType(fileExt: string): EditorConfig[] {
    const ext = fileExt.toLowerCase().replace('.', '');
    return getConfiguredEditors().filter(editor => editor.fileTypes.includes(ext));
}

/**
 * Generate a URL or protocol handler for opening a document in an external editor
 */
export function generateEditorUrl(
    editor: EditorConfig,
    filePath: string,
    fileUrl: string,
    documentId: number
): string {
    if (!editor.launchUrl) {
        return '';
    }

    return editor.launchUrl
        .replace('{FILE_PATH}', encodeURIComponent(filePath))
        .replace('{FILE_URL}', encodeURIComponent(fileUrl))
        .replace('{DOCUMENT_ID}', documentId.toString());
}

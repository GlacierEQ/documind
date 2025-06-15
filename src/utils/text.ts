/**
 * Truncates text to a maximum length while preserving word boundaries
 */
export function truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
        return text;
    }

    // Find a good truncation point near the max length
    const truncateAt = text.lastIndexOf(' ', maxLength);

    if (truncateAt === -1) {
        // If no space found, just truncate at maxLength
        return text.substring(0, maxLength) + '...';
    }

    return text.substring(0, truncateAt) + '...';
}

/**
 * Extracts the most important sentences from text
 * Simple extractive summarization
 */
export function extractImportantSentences(text: string, count: number = 5): string[] {
    // Split text into sentences
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [];

    if (sentences.length <= count) {
        return sentences;
    }

    // Score sentences based on simple heuristics (length, position, keyword frequency)
    const scores = new Map<string, number>();

    // Extract common keywords (simple approach)
    const words = text.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 3);

    const wordFrequency = new Map<string, number>();

    words.forEach(word => {
        wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1);
    });

    // Sort keywords by frequency
    const keywords = [...wordFrequency.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(entry => entry[0]);

    // Score each sentence
    sentences.forEach((sentence, index) => {
        const sentenceLower = sentence.toLowerCase();
        let score = 0;

        // Position score (first and last paragraphs often contain important info)
        if (index < sentences.length * 0.2 || index > sentences.length * 0.8) {
            score += 2;
        }

        // Length score (avoid very short sentences)
        if (sentence.length > 40 && sentence.length < 200) {
            score += 1;
        }

        // Keyword score
        keywords.forEach(keyword => {
            if (sentenceLower.includes(keyword)) {
                score += 1;
            }
        });

        scores.set(sentence, score);
    });

    // Get top scoring sentences while preserving order
    return sentences
        .map(s => ({ sentence: s, score: scores.get(s) || 0 }))
        .sort((a, b) => b.score - a.score)
        .slice(0, count)
        .sort((a, b) => {
            // Get original index
            const idxA = sentences.indexOf(a.sentence);
            const idxB = sentences.indexOf(b.sentence);
            return idxA - idxB;
        })
        .map(s => s.sentence);
}

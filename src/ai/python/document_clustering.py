"""
Document clustering using NLP techniques
Uses scikit-learn to cluster documents based on TF-IDF vectorization
"""

import os
import sys
import json
import uuid
import argparse
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.cluster import KMeans, DBSCAN
from sklearn.decomposition import TruncatedSVD
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.feature_extraction import text

# Parse command line arguments
parser = argparse.ArgumentParser(description='Cluster documents using NLP')
parser.add_argument('--input', required=True, help='Input JSON file with document texts')
parser.add_argument('--output', required=True, help='Output JSON file for clustering results')
parser.add_argument('--method', default='kmeans', help='Clustering method: kmeans or dbscan')
parser.add_argument('--max_clusters', type=int, default=10, help='Maximum number of clusters')
args = parser.parse_args()

# Load documents
with open(args.input, 'r', encoding='utf-8') as f:
    doc_texts = json.load(f)

# Check if we have enough documents
if len(doc_texts) < 5:
    print("Not enough documents for clustering")
    result = {"clusters": []}
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(result, f)
    sys.exit(0)

# Prepare document data
doc_ids = list(doc_texts.keys())
texts = [doc_texts[doc_id] for doc_id in doc_ids]

# Add legal-specific stopwords
legal_stopwords = [
    'court', 'plaintiff', 'defendant', 'motion', 'case', 'order',
    'file', 'filed', 'pursuant', 'party', 'parties', 'shall', 'judge',
    'herein', 'thereof', 'hereby', 'wherefore', 'whatsoever', 'wheresoever',
    'therefrom', 'hereinafter', 'hereto', 'therein', 'aforesaid'
]
stop_words = text.ENGLISH_STOP_WORDS.union(legal_stopwords)

# Create TF-IDF vectorizer and transform documents
vectorizer = TfidfVectorizer(
    max_features=5000,
    min_df=2,
    max_df=0.85,
    stop_words=stop_words,
    ngram_range=(1, 2)
)
tfidf_matrix = vectorizer.fit_transform(texts)

# Apply dimensionality reduction if we have many documents
if len(texts) > 20:
    n_components = min(50, len(texts) - 1)
    svd = TruncatedSVD(n_components=n_components)
    normalized_matrix = svd.fit_transform(tfidf_matrix)
else:
    normalized_matrix = tfidf_matrix.toarray()

# Determine optimal number of clusters
max_clusters = min(args.max_clusters, len(texts) // 2)
optimal_clusters = max(2, min(5, len(texts) // 5))  # Simple heuristic

# Perform clustering
if args.method == 'dbscan':
    # DBSCAN clustering (density-based)
    clustering = DBSCAN(eps=0.5, min_samples=2).fit(normalized_matrix)
    labels = clustering.labels_
else:
    # K-means clustering (default)
    clustering = KMeans(n_clusters=optimal_clusters, random_state=42).fit(normalized_matrix)
    labels = clustering.labels_

# Extract keywords for each cluster
feature_names = vectorizer.get_feature_names_out()
cluster_keywords = {}

# For K-means, we can use cluster centers
if args.method != 'dbscan':
    order_centroids = clustering.cluster_centers_.argsort()[:, ::-1]
    for cluster_idx in range(optimal_clusters):
        top_keywords = [feature_names[i] for i in order_centroids[cluster_idx, :10]]
        cluster_keywords[cluster_idx] = top_keywords
else:
    # For DBSCAN, calculate most common terms in each cluster
    for cluster_idx in set(labels):
        if cluster_idx == -1:  # Noise points
            continue
        
        cluster_docs = [i for i, label in enumerate(labels) if label == cluster_idx]
        cluster_tfidf = tfidf_matrix[cluster_docs].toarray().sum(axis=0)
        top_indices = cluster_tfidf.argsort()[-10:][::-1]
        top_keywords = [feature_names[i] for i in top_indices]
        cluster_keywords[cluster_idx] = top_keywords

# Calculate document similarities within clusters
document_similarities = {}
for i, doc_id in enumerate(doc_ids):
    document_similarities[doc_id] = {}
    for j, other_id in enumerate(doc_ids):
        if i != j:
            sim = cosine_similarity([normalized_matrix[i]], [normalized_matrix[j]])[0][0]
            document_similarities[doc_id][other_id] = float(sim)

# Prepare output structure
clusters = []
for cluster_idx in set(labels):
    if cluster_idx == -1 and args.method == 'dbscan':  # Noise points in DBSCAN
        continue
    
    cluster_docs = [(doc_id, i) for i, doc_id in enumerate(doc_ids) if labels[i] == cluster_idx]
    
    # Skip clusters with only one document
    if len(cluster_docs) < 2:
        continue
    
    # Calculate similarity to cluster centroid
    documents = []
    for doc_id, idx in cluster_docs:
        # Calculate average similarity with other documents in cluster
        similarities = [document_similarities[doc_id][other_id] for other_id, _ in cluster_docs if doc_id != other_id]
        avg_similarity = sum(similarities) / len(similarities) if similarities else 0
        
        documents.append({
            "id": int(doc_id),
            "similarity": round(avg_similarity, 3)
        })
    
    # Create cluster info
    cluster_info = {
        "id": str(uuid.uuid4()),
        "name": f"Document Cluster {len(clusters) + 1}",
        "description": f"Group of {len(documents)} similar documents",
        "keywords": cluster_keywords.get(cluster_idx, [])[:5],
        "documents": sorted(documents, key=lambda x: x["similarity"], reverse=True)
    }
    
    clusters.append(cluster_info)

# Write results to output file
result = {"clusters": clusters}
with open(args.output, 'w', encoding='utf-8') as f:
    json.dump(result, f)

print(f"Clustering complete. Found {len(clusters)} clusters.")

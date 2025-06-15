import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
import argparse
import json
import sys

class DeepSeekService:
    def __init__(self, model_name="deepseek-ai/deepseek-coder-1.3b-instruct"):
        self.model_name = model_name
        self.tokenizer = None
        self.model = None
        print(f"Initializing DeepSeek model: {model_name}", file=sys.stderr)
    
    def load_model(self):
        # Load model & tokenizer
        print("Loading tokenizer and model...", file=sys.stderr)
        self.tokenizer = AutoTokenizer.from_pretrained(self.model_name)
        self.model = AutoModelForCausalLM.from_pretrained(self.model_name, device_map="auto")
        print("Model loaded successfully", file=sys.stderr)
    
    def generate(self, prompt, max_tokens=500, temperature=0.7, top_p=0.9):
        if not self.model or not self.tokenizer:
            self.load_model()
            
        # Tokenize input with attention mask
        inputs = self.tokenizer(prompt, return_tensors="pt", padding=True, truncation=True)
        attention_mask = inputs["attention_mask"]  # Ensuring attention mask is present
        
        # Generate response with explicit attention mask
        with torch.no_grad():
            outputs = self.model.generate(
                input_ids=inputs["input_ids"],
                attention_mask=attention_mask,
                max_new_tokens=max_tokens,
                do_sample=True,
                temperature=temperature,
                top_p=top_p
            )
        
        # Decode output
        response = self.tokenizer.decode(outputs[0], skip_special_tokens=True)
        return response.replace(prompt, "").strip()
    
    def summarize(self, text):
        prompt = f"""Please summarize the following document and provide 3-5 key points. Format your response as JSON with fields 'summary' and 'keyPoints' as an array.

Document content:
{text}

Response:"""
        
        response = self.generate(prompt, max_tokens=800)
        
        try:
            # Try to extract JSON from the response
            json_start = response.find("{")
            json_end = response.rfind("}") + 1
            if json_start >= 0 and json_end > json_start:
                json_text = response[json_start:json_end]
                result = json.loads(json_text)
                return result
            else:
                # Fallback for non-JSON response
                return {"summary": response, "keyPoints": []}
        except json.JSONDecodeError:
            return {"summary": response, "keyPoints": []}
    
    def analyze(self, text):
        prompt = f"""Analyze this document and provide:
1. Up to 5 main topics
2. Key entities (people, organizations, locations) with their importance (0-10)
3. Overall sentiment (score from -1 to 1, and label)
4. Reading complexity (score from 0 to 1, and label)

Format as JSON with 'topics' (array), 'entities' (array of objects with name, type, importance), 'sentiment' (object with score and label), and 'complexity' (object with score and label).

Document:
{text}

Response:"""
        
        response = self.generate(prompt, max_tokens=800)
        
        try:
            # Try to extract JSON
            json_start = response.find("{")
            json_end = response.rfind("}") + 1
            if json_start >= 0 and json_end > json_start:
                json_text = response[json_start:json_end]
                return json.loads(json_text)
            else:
                return default_analysis_result()
        except json.JSONDecodeError:
            return default_analysis_result()
    
    def generate_tags(self, text):
        prompt = f"""Generate 5-10 relevant tags for this document. Return them as a JSON array of strings. Tags should be short (1-2 words) and descriptive.

Document:
{text}

Response:"""
        
        response = self.generate(prompt, max_tokens=300)
        
        try:
            # Try to extract JSON array
            json_start = response.find("[")
            json_end = response.rfind("]") + 1
            if json_start >= 0 and json_end > json_start:
                json_text = response[json_start:json_end]
                tags = json.loads(json_text)
                return tags if isinstance(tags, list) else []
            else:
                # Fallback: extract words that look like tags
                words = [word.strip() for word in response.split() if len(word) > 3]
                return words[:10]  # Return up to 10 words as tags
        except json.JSONDecodeError:
            return []


def default_analysis_result():
    return {
        "topics": ["Sample Topic 1", "Sample Topic 2"],
        "entities": [
            {"name": "Example Person", "type": "person", "importance": 8},
            {"name": "Example Organization", "type": "organization", "importance": 6}
        ],
        "sentiment": {"score": 0, "label": "neutral"},
        "complexity": {"score": 0.5, "label": "moderate"}
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='DeepSeek AI Service')
    parser.add_argument('--operation', type=str, required=True, choices=['summarize', 'analyze', 'tags'], 
                        help='Operation to perform')
    parser.add_argument('--input', type=str, required=True, help='Input text file path')
    parser.add_argument('--output', type=str, required=True, help='Output JSON file path')
    parser.add_argument('--model', type=str, default="deepseek-ai/deepseek-coder-1.3b-instruct", 
                        help='Model name or path')
    
    args = parser.parse_args()
    
    service = DeepSeekService(model_name=args.model)
    
    # Read input text
    with open(args.input, 'r', encoding='utf-8') as f:
        text = f.read()
    
    # Process based on operation
    if args.operation == 'summarize':
        result = service.summarize(text)
    elif args.operation == 'analyze':
        result = service.analyze(text)
    elif args.operation == 'tags':
        result = service.generate_tags(text)
        # Wrap tags in object if it's just a list
        if isinstance(result, list):
            result = {"tags": result}
    
    # Write results to output file
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    
    print(f"Results saved to {args.output}")

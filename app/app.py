from flask import Flask, Response, request
from flask_cors import CORS
import json
import time
import os
from openai import AzureOpenAI
from langchain_openai import AzureChatOpenAI
from langchain.callbacks.base import BaseCallbackHandler

class StreamHandler(BaseCallbackHandler):
    def on_llm_new_token(self, token: str, **kwargs):
        print(token, end='', flush=True)  # Print each token as it arrives

from dotenv import load_dotenv


from common.prompts import DECISION_STEP_PROMPT, QUERY_TRANSLATION_PROMPT, MAIN_SYSTEM_PROMPT
from common.azure_cosmos_db import AzureCosmosDB
from datetime import datetime
from azure.core.credentials import AzureKeyCredential  
from azure.search.documents import SearchClient  
from azure.search.documents.models import VectorizedQuery

load_dotenv()


aoai_endpoint = os.getenv('AOAI_ENDPOINT')
aoai_key = os.getenv('AOAI_KEY')
aoai_deployment = os.getenv('AOAI_DEPLOYMENT')

aoai_client = AzureOpenAI(
        azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT"), 
        api_key=os.getenv("AZURE_OPENAI_KEY"),  
        api_version="2023-05-15"
        )


cosmos_key = os.getenv('COSMOS_MASTER_KEY')
cosmos_host = os.getenv('COSMOS_HOST')
cosmos_db_id = os.getenv('COSMOS_DATABASE_ID')
cosmos_container_id = os.getenv('COSMOS_CONTAINER_ID')

search_endpoint = os.getenv('AZURE_SEARCH_ENDPOINT')
search_key = os.getenv('AZURE_SEARCH_KEY')
search_index = os.getenv('AZURE_SEARCH_INDEX')

cosmos_db = AzureCosmosDB()


cosmos_db.get_or_create_database(cosmos_db_id)
cosmos_db.get_or_create_container(cosmos_container_id)


app = Flask(__name__)
CORS(app)


primary_llm = AzureChatOpenAI(
            azure_deployment=aoai_deployment,
            api_version="2024-05-01-preview",
            temperature=0,
            max_tokens=None,
            timeout=None,
            max_retries=2,
            api_key=aoai_key,
            azure_endpoint=aoai_endpoint
    )


def generate_embeddings(text, model="text-embedding-ada-002"): # model = "deployment_name"
    return aoai_client.embeddings.create(input = [text], model=model).data[0].embedding


class chat_interaction():  
    def __init__(self, user_input, user_id):  
        self.cosmos_db = AzureCosmosDB()
        self.user_input = user_input
        self.user_id = user_id
        self.timestamp = datetime.fromtimestamp(time.time()).strftime('%Y%m%d%H%M%S')
        self.interaction_id = self.user_id + "_" + self.timestamp
        self.step_telemetry = []
        self.application_name = "dans_assistant"
  

    def run(self):
        
        #Analyze the user input and decide what to do
        #Yield: "Analyzing the question..."
        decision = yield from self.decision_step()
        
        if decision == "DocStore":
            #Search the doc store
            #Yield: "Searching the document repository..."
            
            context = yield from self.docstore_agent()

        elif decision == "SQL":
            #Search the database
            #Yield: "Searching the database..."
            yield {"type": "search", "text": "Searching the database..."}
            result = "SQL"
        elif decision == "BASE":
            #Run the base LLM
            #Yield: none
            print("Running BASE LLM call")
            # messages = [
            # {"role": "system", "content": MAIN_SYSTEM_PROMPT},
            # {"role": "user", "content": self.user_input},
            # ]
            # result = self.inference(primary_llm, messages, "main")
            
            
        elif decision == "WebSearch":
            #Run a web search
            #Yield: none
            print("Running WebSearch Agent")
            result = "WebSearch"
        else:
            #Encountered a problem deciding what to do
            #Yield: none
            print("Encountered a problem deciding what to do")
        

        # messages = [
        #     {"role": "system", "content": MAIN_SYSTEM_PROMPT},
        #     {"role": "user", "content": self.user_input},
        #     ]
        # result = ""
        # for chunk in primary_llm.stream(messages):
        #     print(chunk.content)
        #     result += chunk.content

        yield from self.final_llm_call(context)

        self.finalize_interaction()
        result = ""
        return result

    def final_llm_call(self, context):

        
        llm_input = "<Start Context>\n" + context + "\n<End Context>\n" + self.user_input

        messages = [
            {"role": "system", "content": MAIN_SYSTEM_PROMPT},
            {"role": "user", "content": llm_input},
        ]
        
        result = ""
        for chunk in primary_llm.stream(messages):
            result += chunk.content
            yield {"type": "stream", "text": result}

    def decision_step(self):  
        print("Running Decision Step")
        yield {"type": "analyze", "text": "Analyzing the question..."}
        messages = [
            {"role": "system", "content": DECISION_STEP_PROMPT},
            {"role": "user", "content": self.user_input},
        ]
        
        decision = self.inference(primary_llm, messages, "decision", json_mode=True)
        decision = decision["answer"]

        return decision
    

    def docstore_agent(self):
        print("Running DocStore Agent")
        yield {"type": "search", "text": "Searching the document repository..."}
        #query translation step 
        messages = [
            {"role": "system", "content": QUERY_TRANSLATION_PROMPT},
            {"role": "user", "content": self.user_input},
        ]
        search_query = self.inference(primary_llm, messages, "query_translation")
        print(search_query)

        search_client = SearchClient(search_endpoint, search_index, AzureKeyCredential(search_key))
        #convert user input and search query to vectors 
        query_vector = generate_embeddings(search_query)
        vector_query = VectorizedQuery(vector=query_vector, k_nearest_neighbors=3, fields="contentVector")

        results = search_client.search(
                search_text=search_query,  
                vector_queries= [vector_query],
                top=3

                                )
        content = ""

        result = {}
        result["context"] = []
        result["answer"] = ""

        for source in results:
        #print("Score: ", result["@search.score"] ," Semantic Reranker Score: ", result["@search.reranker_score"] ,result["sourcepage"], " --- ", result["summary"])
        #print(result)
            print("Score: ", source["@search.score"] ,source["id"])
            content_chunk = "<Content Chunk Start>\n" + source["content"] + "\n<Content Chunk End>\n" + "<source: " + source["id"] + ">\n\n\n"
            content += content_chunk
            result["context"].append(source["id"])

        telemetry = {
            "step_name": "index_search", 
            "step_type": "retrieval",
            "index": search_index,
            "search_query": search_query,
            "query_type": "hybrid",
            "results": result["context"],

        }
        self.step_telemetry.append(telemetry)
        print(content)

        for source in result["context"]:
            print("Source: ", source)
        
        # messages = [
        #     {"role": "system", "content": MAIN_SYSTEM_PROMPT },
        #     {"role": "user", "content": self.user_input + "\n" + content},
        # ]

        # response = self.inference(primary_llm, messages, "main")

        return content

        
    def inference(self, llm, messages, step, json_mode=False):
    
        start_time = time.time()
        # messages = [{"role": "system", "content": "You are a helpful AI assistant. always respond in json format with your thought process and answer."}]
        # messages.append([{"role": "user", "content": "What is 2+2?"}])

        if json:
            llm.bind(response_format={"type": "json_object"})

        raw_response = llm.invoke(messages)
        end_time = time.time()
        latency = end_time - start_time
        
        response = raw_response.content

        if json_mode:
            response = json.loads(raw_response.content)
            

        messages.append({"role": "assistant", "content": response})

        telemetry = {
            "step_name": step, 
            "step_type": "llm",
            "endpoint": llm.azure_endpoint,
            "deployment": llm.deployment_name,
            "version": llm.openai_api_version, 
            "messages": messages,
            "tokens": raw_response.usage_metadata,
            "latency": latency

        }
        self.step_telemetry.append(telemetry)
        #cosmos_db.write_to_cosmos(telemetry)
        return response

    def finalize_interaction(self):
        # Compile all steps into a single document
        interaction_document = {
            "id": self.interaction_id,
            "user": self.user_id,
            "timestamp": self.timestamp,
            "application": self.application_name,
            "steps": self.step_telemetry
        }
        # Write the compiled document to Cosmos DB
        cosmos_db.write_to_cosmos(interaction_document)

@app.route('/run', methods=['GET', 'POST'])
def run():
    if request.method == 'POST':
        user_message = request.json['message']
    else:  # GET
        user_message = request.args.get('message', '')

    def run_interaction():
        
        interaction = chat_interaction(user_message, "djg")
        for step in interaction.run():
            if step['type'] == 'stream':
                yield f"event: update\ndata: {json.dumps(step)}\n\n"
            else:
                yield f"data: {json.dumps(step)}\n\n"


    return Response(run_interaction(), mimetype='text/event-stream')

if __name__ == '__main__':
    app.run(debug=True)
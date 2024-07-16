import os  
import azure.cosmos.documents as documents  
import azure.cosmos.cosmos_client as cosmos_client  
import azure.cosmos.exceptions as exceptions  
from azure.cosmos.partition_key import PartitionKey  
  
class AzureCosmosDB:  
    def __init__(self):  
        self.host = os.getenv("COSMOS_HOST")  
        self.master_key = os.getenv("COSMOS_MASTER_KEY")  
        self.database_id = os.getenv("COSMOS_DATABASE_ID")  
        self.container_id = os.getenv("COSMOS_CONTAINER_ID")  
        self.client = cosmos_client.CosmosClient(self.host, {'masterKey': self.master_key}, user_agent="CosmosDBPythonQuickstart", user_agent_overwrite=True)  
        self.db = self.get_or_create_database(self.database_id)  
        self.container = self.get_or_create_container(self.container_id)  
  
    def get_or_create_database(self, database_id):  
        try:  
            return self.client.create_database(id=database_id)  
        except exceptions.CosmosResourceExistsError:  
            return self.client.get_database_client(database_id)  
  
    def get_or_create_container(self, container_id):  
        try:  
            return self.db.create_container(id=container_id, partition_key=PartitionKey(path='/application'))  
        except exceptions.CosmosResourceExistsError:  
            return self.db.get_container_client(container_id)  
  
    def write_to_cosmos(self, json_data):  
        try:  
            self.container.create_item(body=json_data)  
            print('Success writing to cosmos...')  
        except exceptions.CosmosHttpResponseError as e:  
            print(f"Error writing to cosmos: {e.message}")  
        except Exception as e:  
            print(f"An unexpected error occurred: {str(e)}")  
            

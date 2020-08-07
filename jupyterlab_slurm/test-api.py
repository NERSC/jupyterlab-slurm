#http://localhost:8845/
import requests
import pytest
import asyncio
import json
import os
from http.client import HTTPConnection
from urllib.parse import quote
from tornado.websocket import websocket_connect


# def test_get_request():
#     r = requests.get('http://localhost:8845/')
#     print(r.text)
#     print("----------------")
#     print(r.headers['Content-Type'])
#     print("----------------")
#     print(r.json())

PORT = os.getenv('TEST_PORT', 8845)
TOKEN = os.getenv('JUPYTER_TOKEN', 'secret')


def request_get(port, path, token, host='localhost'):
    h = HTTPConnection(host, port, 10)
    if '?' in path:
        url = '{}&token={}'.format(path, token)
      
    else:
        url = '{}?token={}'.format(path, token)
    h.request('GET', url)
    return h.getresponse()

def test_sbatch():
    r = request_get(PORT, '/sbatch?inputType=contents', TOKEN)
    #print(dir(r))
    print(r.read)
    assert r.code == 200 
    #response = (json.loads(r.read().decode("utf-8")))
    #print(response["data"])
    

def test_squeue():
    jobID = []
    r = request_get(PORT, '/squeue?userOnly=true', TOKEN)
    response = (json.loads(r.read().decode("utf-8")))
    print(response["data"])
    jobID += response["data"]
    assert r.code == 200 

# def test_scontrol():
#     r = request_get(PORT, '/scontrol', TOKEN)
#     assert r.code == 200 

# def test_scancel():
#     r = request_get(PORT, '/scancel', TOKEN)


if __name__ == '__main__':
    test_sbatch()
    test_squeue()
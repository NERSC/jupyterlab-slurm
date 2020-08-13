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

# def request_post(port, path, token, host='localhost'):
#     h = HTTPConnection(host, port, 10)
#     if '?' in path:
#         url = '{}&token={}'.format(path, token)
      
#     else:
#         url = '{}?token={}'.format(path, token)
#     params = urllib.parse.urlencode({"input":"#!/bin/sh"})
#     headers = {"Content-type": "application/json",
# ...            "Accept": "*/*"}
#     h.request('POST', url)
#     return h.getresponse()

def request_delete(port, path, token, host='localhost'):
    h = HTTPConnection(host, port, 10)
    if '?' in path:
        url = '{}&token={}'.format(path, token)
      
    else:
        url = '{}?token={}'.format(path, token)
    h.request('DELETE', url)
    return h.getresponse()


def test_sbatch():
    #r = request_post(PORT, '/sbatch?inputType=path', TOKEN)
    r = requests.post('http://localhost:8845/sbatch?inputType=contents&outputDir=~%2FDesktop%2Fjupyterlab-slurm%2F&token='+TOKEN, data = '{"input":"#!/bin/sh"}', headers={"content-type": "application/json"} )
    #print(dir(r))
    #print(r.msg)
    print(r.text)
    assert r.status_code == 200 
    #response = (json.loads(r.read().decode("utf-8")))
    #print(response["data"])
    

def test_squeue():
    jobID = []
    r = requests.get('http://localhost:8845/squeue?userOnly=true&token='+ TOKEN)
    #r = request_get(PORT, '/squeue?userOnly=true', TOKEN)
    # response = (json.loads(r.read().decode("utf-8")))
    # print(response["data"])
    # jobID += response["data"]
    assert r.status_code == 200

# def test_scontrol():
#     r = request_get(PORT, '/scontrol', TOKEN)
#     assert r.code == 200 

def test_scancel():

    #r = request_get(PORT, '/scancel', TOKEN)
    r = requests.delete('http://localhost:8845/scancel?token=' + TOKEN, data =  json.dumps({ "jobID": '33241147' }), headers={"content-type": "application/json"})
    #print(r.read)
    print(r.text)
    assert r.status_code == 200


if __name__ == '__main__':
    test_sbatch()
    test_squeue()
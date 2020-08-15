#http://localhost:8845/
import requests
import pytest
import asyncio
import json
import os
from http.client import HTTPConnection
from urllib.parse import quote
from tornado.websocket import websocket_connect


PORT = os.getenv('TEST_PORT', 8845)
TOKEN = os.getenv('JUPYTER_TOKEN', 'secret')


def test_sbatch():
    r = requests.post('http://localhost:8845/sbatch?inputType=contents&outputDir=%2Ftmp&token='+TOKEN, data = '{"input":"#!/bin/sh"}', headers={"content-type": "application/json"} )
    assert r.status_code == 200
    
    fail_r = requests.post('http://localhost:8845/sbatch?inputType=contents&outputDir=%2Ftmp&token='+TOKEN, headers={"content-type": "application/json"} )
    assert fail_r.status_code != 200

def test_squeue():
    jobID = []
    r = requests.get('http://localhost:8845/squeue?userOnly=true&token='+ TOKEN)
    assert r.status_code == 200
    assert len(r.json()['data'][0]) == 8

    fail_r = requests.get('http://localhost:8845/squeue&token='+ TOKEN)
    print(fail_r.text)
    assert fail_r.status_code != 200


def test_scontrol():
    r = requests.patch('http://localhost:8845/scontrol/hold?token='+ TOKEN, data =  json.dumps({ "jobID": '33241147' }), headers={"content-type": "application/json"})
    assert r.status_code == 200
    assert ("Success: scontrol hold") in r.json()['responseMessage']

    fail_r = requests.patch('http://localhost:8845/scontrol/hold?token='+ TOKEN, headers={"content-type": "application/json"})
    assert fail_r.status_code != 200


def test_scancel():
    r = requests.delete('http://localhost:8845/scancel?token=' + TOKEN, data =  json.dumps({ "jobID": '33241147' }), headers={"content-type": "application/json"})
    assert r.status_code == 200
    assert ("Success: scancel") in r.json()['responseMessage']

    fail_r = requests.delete('http://localhost:8845/scancel?token=' + TOKEN, data =  json.dumps({ "jobID": '33241147' }))
    assert fail_r.status_code != 200

if __name__ == '__main__':
    test_sbatch()
    test_squeue()
import json


async def test_get_example(jp_fetch):
    response = await jp_fetch("jupyterlab_slurm", "get_example")

    assert response.code == 200
    payload = json.loads(response.body)
    expected_payload = {
        "data": "This is the /jupyterlab_slurm/get_example endpoint!"
    }
    assert payload == expected_payload

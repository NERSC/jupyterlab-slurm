import time
from selenium import webdriver
from selenium.webdriver.firefox.options import Options

class Test():
    def setup_method(self, method):
        options = Options()
        options.headless = True
        self.driver = webdriver.Firefox(options=options)
        self.vars = {}
    
    def teardown_method(self, method):
        self.driver.quit()

    def wait_for_window(self, timeout = 2):
        time.sleep(round(timeout / 1000))
        wh_now = self.driver.window_handles
        wh_then = self.vars["window_handles"]
        if len(wh_now) > len(wh_then):
            return set(wh_now).difference(set(wh_then)).pop()
    
    def test(self):
        # Open the browser
        self.driver.get('http://localhost:8888')
        self.driver.implicitly_wait(10)

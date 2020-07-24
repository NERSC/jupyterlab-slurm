import pytest
import time
import json
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.support import expected_conditions
from selenium.webdriver.support.wait import WebDriverWait
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.desired_capabilities import DesiredCapabilities

class TestAddfavs():
    def setup_method(self, method):
        self.driver = webdriver.Firefox()
        self.vars = {}
  
    def teardown_method(self, method):
        self.driver.quit()
  
    def test_checktext(self):
        self.driver.get("http://localhost:8845/lab")
        self.driver.implicitly_wait(30)
        self.driver.maximize_window()
        self.driver.implicitly_wait(30)
        #WebDriverWait(self.driver, 1000)

        #card_text = self.driver.find_element(By.XPATH, "/html/body/div/div[3]/div[2]/div[3]/div[3]/div[2]/div/div/div[5]/div[2]/div")
        #assert card_text.text == "Slurm Queue"
        slurm_card = self.driver.find_element(By.XPATH, "/html/body/div/div[3]/div[2]/div[3]/div[3]/div[2]/div/div/div[5]/div[2]/div")
        self.driver.implicitly_wait(30)
        assert slurm_card.text == "Slurm Queue"
        #slurm_card = driver.find_element(By.XPATH, "/html/body/div/div[3]/div[2]/div[3]/div[3]/div[2]/div/div/div[5]/div[2]/div")
        self.driver.implicitly_wait(30)
        actions = ActionChains(self.driver)
        self.driver.execute_script("window.scrollTo(0,document.body.scrollHeight)")
        actions.click(slurm_card).perform()
        actions.click(slurm_card).perform()
        self.driver.implicitly_wait(30)

        #slurm_tab = self.driver.find_element(By.XPATH, "/html/body/div/div[3]/div[2]/div[3]/div[2]/ul/li[2]/div[2]") 
        slurm_tab = self.driver.find_element_by_css_selector("li.p-mod-current:nth-child(2) > div:nth-child(2)")
        # slurm_tab = self.driver.find_element(By.XPATH, "//div[contains(text(),'Slurm Queue Manager')]")
        assert slurm_tab.text == "Slurm Queue Manager"

        close_tab = self.driver.find_element(By.XPATH, "/html/body/div/div[3]/div[2]/div[3]/div[2]/ul/li[2]/div[3]")
        actions = ActionChains(self.driver)
        actions.click(close_tab).perform()

if __name__ == '__main__':
  setup_method()
  test_checktext()
  teardown_method()
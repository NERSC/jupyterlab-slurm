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
from selenium.common.exceptions import NoSuchElementException

class TestAddfavs():
    def setup_method(self, method):
        self.driver = webdriver.Firefox()
        self.vars = {}
  
    def teardown_method(self, method):
        self.driver.quit()
  
    def test_checktext(self):
        #import pdb; pdb.set_trace()

        self.driver.get("http://localhost:8845/lab")
        self.driver.implicitly_wait(30)
        self.driver.maximize_window()
        self.driver.implicitly_wait(30)
        
        #card_text = self.driver.find_element(By.XPATH, "/html/body/div/div[3]/div[2]/div[3]/div[3]/div[2]/div/div/div[5]/div[2]/div")
        #assert card_text.text == "Slurm Queue"
        
        slurm_card = self.driver.find_elements_by_class_name('jp-NerscLaunchIcon')
        #assert slurm_card.text == "Slurm Queue"
        
        self.driver.implicitly_wait(10)
        self.driver.execute_script("window.scrollTo(0,document.body.scrollHeight)")
        actions = ActionChains(self.driver)
        actions.click(slurm_card[1]).perform()
        #actions.click(slurm_card[1]).perform()
        self.driver.implicitly_wait(10)

        # try: 
        #     jobid_text = self.driver.find_element(By.XPATH, "//*[contains(text(),'JOBID')]")
        #     assert jobid_text.text == "JOBID"

        #     partition_text = self.driver.find_element(By.XPATH, "//*[contains(text(),'PARTITION')]")
        #     assert partition_text.text == "PARTITION"

        #     close_tab = self.driver.find_element(By.XPATH, "/html/body/div/div[3]/div[2]/div[3]/div[2]/ul/li[2]/div[3]")
        #     actions = ActionChains(self.driver)
        #     actions.click(close_tab).perform()
        # except NoSuchElementException:
        #     print('No slurm elements found')

        jobid_text = self.driver.find_element(By.XPATH, "//th[contains(text(),'JOBID')]")
        assert jobid_text.text == "JOBID"

        partition_text = self.driver.find_element(By.XPATH, "//th[contains(text(),'PARTITION')]")
        assert partition_text.text == "PARTITION"

        close_tab = self.driver.find_element(By.XPATH, "/html/body/div/div[3]/div[2]/div[3]/div[2]/ul/li[2]/div[3]")
        actions = ActionChains(self.driver)
        actions.click(close_tab).perform()

if __name__ == '__main__':
  setup_method()
  test_checktext()
  teardown_method()
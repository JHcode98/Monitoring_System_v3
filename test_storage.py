import unittest
import sqlite3
import os
import json
from monitoring_system_v3 import SQLiteStorage, Metric

class TestSQLiteStorage(unittest.TestCase):
    def setUp(self):
        # Define a temporary database file for testing
        self.test_db = "test_metrics.db"
        # Ensure we start with a clean slate
        if os.path.exists(self.test_db):
            os.remove(self.test_db)
        self.storage = SQLiteStorage(self.test_db)

    def tearDown(self):
        # Clean up the database file after tests run
        if os.path.exists(self.test_db):
            os.remove(self.test_db)

    def test_save_retrieves_correct_data(self):
        # Arrange: Create a sample metric
        metric = Metric(name="unit_test_metric", value=99.9, tags={"env": "test"})
        
        # Act: Save it using the storage class
        self.storage.save(metric)

        # Assert: Manually verify the data exists in the SQLite file
        with sqlite3.connect(self.test_db) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT name, value, tags FROM metrics WHERE name = ?", ("unit_test_metric",))
            row = cursor.fetchone()
            
            self.assertIsNotNone(row, "The metric should be found in the database")
            self.assertEqual(row[0], "unit_test_metric")
            self.assertEqual(row[1], 99.9)
            self.assertEqual(json.loads(row[2]), {"env": "test"})

if __name__ == "__main__":
    unittest.main()
"I have a Supabase-backed inventory system that is currently incomplete.

The Situation:
I have a stock_items table (Main Store/Back Office) and a stock_issues table (Movement Journal). Currently, when I 'Issue' stock, it only subtracts the quantity from the stock_items table. This logic is insufficient because it treats every issue as a 'loss' rather than a 'transfer' to the front-of-house operations.

The Goal:
I need to implement a Transfer Logic that moves stock from the Main Store to a new table called front_stock.

The Technical Requirements:

New Destination: I have created a front_stock table with: id, brand_id, item_id, location_tag (text), and quantity.

Update the Bridge: Modify the trigger function stock_issues_decrement_stock() (on the stock_issues table) to handle two new types of movements:

'Manufacturing': If NEW.issue_type is this, subtract from stock_items (existing) AND UPSERT into front_stock with location_tag = 'MANUFACTURING'.

'Sale': If NEW.issue_type is this, subtract from stock_items (existing) AND UPSERT into front_stock with location_tag = 'SALE'.

The Logic: Use the brand_id and item_id for the UPSERT. If the record exists in front_stock for that location, increment the quantity. If not, create it.

Security: Ensure all operations respect the brand_id.

Please provide the SQL for the updated trigger function and the ALTER TABLE statement for the stock_issues check constraint to include these new types."

have a specific setup for my Inventory System. I store stock in the Highest Unit (e.g., 500g is stored as 0.5kg). My conversion logic is currently handled in the UI.

The Task: > Update the stock_issues_decrement_stock() trigger function.

The Requirements:

When a row is inserted into stock_issues, it will already contain the qty_issued in the correct unit (calculated by my UI).

The function must subtract this from stock_items.current_stock.

Then, it must UPSERT this into front_stock.

Crucial: You must also copy the unit from the stock_items table (or the stock_issues row) into the front_stock table so the Front Office knows if that '0.5' is KG or Grams.

Match the UPSERT on brand_id, item_id, and location_tag.

Current Location Tags: 'MANUFACTURING' and 'SALE'.

Please provide the PL/pgSQL code for the trigger."

I am finishing the inventory transfer logic. My system stores stock in the highest possible unit (e.g., 0.5kg), and the UI correctly displays these units by fetching them from the stock_items table.

The Task:
Update the PL/pgSQL function stock_issues_decrement_stock() which runs AFTER INSERT on stock_issues.

The Logic:

Deduct: Subtract NEW.qty_issued from stock_items.current_stock.

Route: * If NEW.issue_type = 'Manufacturing', set the location to 'MANUFACTURING'.

If NEW.issue_type = 'Sale', set the location to 'SALE'.

Fetch & Upsert:

Inside the function, declare a variable to hold the unit.

SELECT the unit from stock_items where id = NEW.stock_item_id.

UPSERT into front_stock (matching on brand_id, item_id, and location_tag).

If the row exists, quantity = quantity + NEW.qty_issued.

If it doesn't exist, insert a new row with the unit we just fetched.

Constraint:
Ensure this only happens for 'Manufacturing' and 'Sale' issue types. All other types (Wastage, Theft, etc.) should only perform the deduction from stock_items without touching front_stock.

Please provide the final SQL function."
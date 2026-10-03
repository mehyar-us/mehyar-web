-- Content Playbook return configuration only. Price, entitlement and orders unchanged.
UPDATE billing_products
SET success_url_template='https://playbook.mehyar.us/success?token={access_token}',
    cancel_url='https://playbook.mehyar.us/#pricing',
    allowed_return_hosts='playbook.mehyar.us'
WHERE id IN ('content-playbook-30day','tiktokgrowth-system');

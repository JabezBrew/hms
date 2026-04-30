from django.db.migrations.loader import MigrationLoader


def test_users_migration_graph_has_no_conflicting_leaf_nodes():
    loader = MigrationLoader(None, ignore_no_migrations=True)

    conflicts = loader.detect_conflicts()

    assert 'users' not in conflicts
    users_leaf_nodes = [
        migration_name
        for app_label, migration_name in loader.graph.leaf_nodes()
        if app_label == 'users'
    ]
    assert len(users_leaf_nodes) == 1

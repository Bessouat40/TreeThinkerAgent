from app.backend.core.models.tool_calls import ToolCall
from app.backend.core.reasoningTree.reasoning_tree import ReasoningTree

tree = ReasoningTree("I want to plan a trip to Madrid.")

# Leaf 1
tree.add_leaf(
    description="Define a travel budget.",
    parent_leaf="leaf_0",
    tool_calls=[
        ToolCall(tool_name="CurrencyConverter", args={"from": "EUR", "to": "USD"}, result="$1000")
    ]
)

# Leaf 2
tree.add_leaf(
    description="Search for flights from Paris to Madrid.",
    parent_leaf="leaf_0",
    tool_calls=[
        ToolCall(tool_name="FlightSearch", args={"origin": "Paris", "destination": "Madrid"}, result="Flights starting at €90")
    ]
)

# Leaf 3
tree.add_leaf(
    description="Find an affordable hotel in Madrid.",
    parent_leaf="leaf_0",
    tool_calls=[
        ToolCall(tool_name="HotelSearch", args={"city": "Madrid", "budget": "<€100/night"}, result="Ibis Hotel, €89/night")
    ]
)

# Leaf 4
tree.add_leaf(
    description="Book the selected flight.",
    parent_leaf="leaf_2",
    tool_calls=[
        ToolCall(tool_name="FlightBooking", args={"flight_id": "AF1234"}, result="Booking confirmed")
    ]
)

# Leaf 5
tree.add_leaf(
    description="Book the selected hotel.",
    parent_leaf="leaf_3",
    tool_calls=[
        ToolCall(tool_name="HotelBooking", args={"hotel_name": "Ibis"}, result="Booking confirmed")
    ]
)

print(tree.get_reasoning_tree_context())
print(tree.leaves)

#!/bin/bash
#SBATCH --nodes={{$number_of_nodes}}
#SBATCH --constraint={{$node_type}}
#SBATCH --time={{$max_wall_time}}
#SBATCH --qos={{$queue_type}}
#SBATCH --account={{$project_account}}
#SBATCH --job-name={{$job_name}}

#insert your execution commands below
